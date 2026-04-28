# Cloud Model Support

## Premise

Add cloud-hosted image generation (Fal, Replicate, OpenAI, etc.) to Enso without requiring changes to sdnext itself.

### Why Enso-side

Enso already owns the entire job lifecycle independently of sdnext's processing pipeline:

- **Job CRUD** - `enso_api/routes.py` + SQLite `jobs.db`
- **Executor dispatch** - `enso_api/executors.py` maps job `type` to a handler function
- **Progress delivery** - per-job WebSocket at `/sdapi/v2/jobs/{id}/ws`
- **Result serving** - `/sdapi/v2/jobs/{id}/images/{index}`
- **Model/sampler enumeration** - `enso_api/endpoints.py` returns lists to the frontend
- **Frontend** - model picker, parameter UI, canvas pipeline are fully Enso-owned

Local generation calls `modules.control.run.control_run()` and acquires `modules.call_queue.queue_lock` to serialize GPU access. Cloud jobs have no GPU contention, so they bypass both - no sdnext cooperation needed.

### What sdnext doesn't need to know

- Cloud provider configuration, API keys, model catalogs
- Job routing decisions (cloud vs local)
- Progress polling of remote APIs
- Result download and storage
- Mixed-pipeline orchestration (cloud generate -> local upscale)

The extension contract (`scripts/enso.py` registers routes on sdnext's FastAPI app) gives Enso full authority to add new job executors without upstream changes.

## Provider Strategy

### Primary: OpenAI-compatible endpoints

The OpenAI API spec is the de facto standard for cloud model access. One adapter implementation covers:

| Provider | Strengths | Notes |
| --- | --- | --- |
| **OpenRouter** | 200+ models, free tiers, live `/v1/models` with pricing/caps | Aggregator - covers most model families |
| **NanoGPT** | Privacy-focused, pay-as-you-go | Smaller catalog, loyal user base |
| **AIHubMix** | Chinese model access (GLM, Qwen), competitive pricing | Good for non-English users |
| **Custom URL** | Self-hosted (vLLM, Ollama, text-gen-webui), any compatible endpoint | Maximum user autonomy |
| **OpenAI direct** | DALL-E, GPT-Image, GPT-4o | Native provider, full feature set |

All share the same auth pattern (Bearer token), endpoint structure (`/v1/models`, `/v1/images/generations`, `/v1/chat/completions`, `/v1/audio/*`), and response format.

### Multi-modal scope

OpenAI-compatible endpoints cover multiple modalities with the same base URL + key:

- **Image generation** - `/v1/images/generations`, `/v1/images/edits`
- **LLM** - `/v1/chat/completions` (prompt enhancement, captioning, chat)
- **Audio** - `/v1/audio/speech`, `/v1/audio/transcriptions`
- **Video** - emerging (Sora-style via `/v1/video/generations` on some providers)

### Secondary: Native provider APIs (future)

For features that can't go through OpenAI-compat (ControlNet, specialized inpainting, intermediate latent streaming):

- **Fal** - native API has img2img + inpaint + ControlNet variants, intermediate latent previews, structured progress
- **Replicate** - prediction API with per-version OpenAPI schemas, webhook progress, hardware selection

These are future additions. The OpenAI-compatible layer is the v1 priority.

## Stage 1 Findings - Provider API Survey

### Model Discovery Comparison

The `/v1/models` response varies dramatically across providers:

| Field | OpenAI | OpenRouter | NanoGPT | vLLM | Ollama |
| --- | --- | --- | --- | --- | --- |
| `id` | yes | yes | yes | yes | yes |
| `object` | `"model"` | `"model"` | `"model"` | `"model"` | `"model"` |
| `created` | model release | model release | present | request time (!) | file mtime (!) |
| `owned_by` | `"openai"` etc | `"openai"` etc | present | hardcoded `"vllm"` | `"library"` |
| Pricing | no | yes (per-token, per-image, per-audio strings) | yes (with `?detailed=true`) | no | no |
| Input modalities | no | yes (array) | no | no | no |
| Output modalities | no | yes (array) | no | no | no |
| Context length | no | yes | no | yes (`max_model_len`) | no |
| Supported params | no | yes (array of param names) | no | no | no |
| Default params | no | yes (temperature, top_p, etc.) | no | no | no |

**Minimum reliable schema across all providers:** `{id: string}`. Everything else is optional or semantically different. The adapter must treat rich metadata as progressive enhancement.

**NanoGPT splits listings by modality:** `/v1/models` (text only), `/v1/image-models` (154 models), `/v1/video-models` (107 models), `/v1/audio-models` (32 TTS + 13 STT + 27 embedding). The adapter needs modality-specific list endpoints as a fallback.

**OpenRouter model ID format:** `provider/model-name[:variant]`. Free models use `:free` suffix. Latest-version aliases use `~` prefix (e.g. `~openai/gpt-mini-latest`).

### Image Generation Endpoint Divergence

This is the most significant cross-provider divergence:

| Provider | Image gen endpoint | Response format |
| --- | --- | --- |
| **OpenAI** | `POST /v1/images/generations` | `{data: [{b64_json\|url, revised_prompt}], usage}` |
| **OpenRouter** | `POST /v1/chat/completions` with `modalities: ["image"]` | Chat completion with image content parts |
| **Ollama** | `POST /v1/images/generations` (experimental) | b64_json only, no `url`, no `n`/`quality`/`style` |
| **text-gen-webui** | `POST /v1/images/generations` | b64_json only |
| **vLLM** | not supported (vllm-omni subproject only) | n/a |
| **NanoGPT** | separate image endpoint | varies |

**Architectural implication:** The adapter cannot assume a single image generation endpoint. It needs per-provider endpoint routing: OpenRouter uses chat completions for image gen, OpenAI uses the dedicated images endpoint, and self-hosted may not support images at all.

**OpenAI `/v1/images/generations` params:**

| Param | Required | Values | Notes |
| --- | --- | --- | --- |
| `prompt` | yes | up to 32000 chars (gpt-image-1) | |
| `model` | no | `dall-e-2`, `dall-e-3`, `gpt-image-1` variants | default `dall-e-2` |
| `n` | no | 1-10 | dall-e-3 only supports 1 |
| `size` | no | model-dependent enum | `auto` for gpt-image |
| `quality` | no | `low`/`medium`/`high`/`auto` (gpt-image), `standard`/`hd` (dall-e-3) | |
| `style` | no | `vivid`/`natural` | dall-e-3 only |
| `response_format` | no | `url`/`b64_json` | gpt-image-1 always b64, must omit field |
| `background` | no | `transparent`/`opaque`/`auto` | gpt-image only |
| `output_format` | no | `png`/`jpeg`/`webp` | gpt-image only |

**OpenAI `/v1/images/edits`** (img2img/inpaint): multipart/form-data with `image` (up to 16 files for gpt-image-1), `mask` (transparent pixels = editable region), `prompt`. Same output params as generations.

### Chat Completions

Broadly consistent across providers, with extensions:

**Universal parameters:** `model`, `messages`, `temperature`, `top_p`, `n`, `stream`, `stop`, `max_tokens`/`max_completion_tokens`, `presence_penalty`, `frequency_penalty`, `seed`, `user`

**OpenRouter extensions beyond spec:**

- `models` array / comma-separated `model` for fallback routing
- `provider` object: `order`, `ignore`, `only`, `allow_fallbacks`, `require_parameters`, `data_collection` (privacy), `quantizations`, `sort` (price/throughput/latency)
- `transforms: ["middle-out"]` for context compression
- `plugins`: web search, file parser, response healing
- `modalities: ["image", "text"]` for image-output models
- `reasoning: {effort}` normalized across providers
- `usage.cost` in USD on every response

**Streaming format (universal):** SSE with `data: {json}\n\n`, terminated by `data: [DONE]\n\n`. Chunks use `delta` instead of `message`. Tool call arguments split across chunks, concatenated by `tool_calls[i].index`.

**Vision input (universal format):**

```json
{"type": "image_url", "image_url": {"url": "https://... or data:image/...;base64,..."}}
```

Variance: Ollama only accepts base64 data URIs (rejects https URLs). All others accept both.

### Audio Endpoints

| Endpoint | OpenAI | OpenRouter | vLLM | Ollama | text-gen-webui |
| --- | --- | --- | --- | --- | --- |
| `POST /v1/audio/speech` (TTS) | yes | yes | no | no | yes |
| `POST /v1/audio/transcriptions` | yes | no (uses chat) | conditional | no | yes |

**OpenAI TTS params:** `model` (tts-1, tts-1-hd, gpt-4o-mini-tts), `input` (up to 4096 chars), `voice` (13 options), `response_format` (mp3/opus/aac/flac/wav/pcm), `speed` (0.25-4.0). Response is binary audio.

**OpenRouter audio:** TTS via `/v1/audio/speech`. Transcription goes through chat completions on audio-capable models (no standalone Whisper endpoint).

### Video Endpoints

| Provider | Endpoint | Async |
| --- | --- | --- |
| **OpenAI** | `POST /v1/videos`, `GET /v1/videos/{id}`, `GET /v1/videos/{id}/content` | yes (poll or webhook) |
| **OpenRouter** | `POST /v1/videos`, `GET /v1/videos/{id}`, `GET /v1/videos/models` | yes (poll or webhook) |

**OpenAI video (Sora):** `model`, `prompt`, `size`, `seconds` (4/8/12). States: `queued` -> `in_progress` -> `completed`/`failed`. Content retrieved via separate GET. **Sunset date: 2026-09-24.**

**OpenRouter video:** `model`, `prompt`, `aspect_ratio`, `duration`, `generate_audio`, `input_references`, `callback_url`. Models: Sora 2, Veo 3.1, Seedance, Wan. Normalized schema across providers.

### Authentication Patterns

| Provider | Header | Key format |
| --- | --- | --- |
| OpenAI | `Authorization: Bearer sk-...` | `sk-` prefix (user) or `sk-proj-` (project) |
| OpenRouter | `Authorization: Bearer ...` | arbitrary string |
| Fal | `Authorization: Key ...` | note: `Key` not `Bearer` |
| Replicate | `Authorization: Bearer r8_...` | `r8_` prefix |
| Ollama | any / none | accepts any string, often no auth required |
| vLLM | `Authorization: Bearer ...` | only if `--api-key` was set at startup |

**OpenRouter extra headers:** `HTTP-Referer` (app URL, recommended), `X-Title` (display name). OpenAI: `OpenAI-Organization`, `OpenAI-Project` for scoping.

### Rate Limiting

All providers that enforce rate limits communicate via response headers:

**OpenAI:** `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests` (and parallel `*-tokens` variants). Per-(org, model, endpoint) buckets.

**OpenRouter:** `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` (ms since epoch). Credit-based: 1 req/credit/sec up to ~500 req/s surge. Free models: 20 req/min.

**Self-hosted:** typically no rate limiting (user controls their own capacity).

### Error Response Formats

**OpenAI:**

```json
{"error": {"message": "...", "type": "invalid_request_error", "param": "model", "code": "model_not_found"}}
```

**OpenRouter:**

```json
{"error": {"code": 429, "message": "...", "metadata": {"headers": {...}, "provider_name": "..."}}}
```

Both use standard HTTP status codes (400, 401, 402, 403, 404, 429, 500, 502, 503). Streaming errors arrive as SSE events mid-stream (HTTP status can't change after first byte).

### Native API Gaps (what OpenAI-compat can't do)

| Capability | Fal | Replicate | OpenAI-compat |
| --- | --- | --- | --- |
| ControlNet (canny/depth/pose) | first-class, per-model paths | per-model OpenAPI schema | not expressible |
| IP-Adapter (style reference) | first-class on flux/SDXL paths | per-model | not expressible |
| Inpainting with mask | `mask_url` parameter | `mask` parameter | `/v1/images/edits` only |
| img2img with strength | `strength` param | `prompt_strength` param | not standard |
| Intermediate latent previews | SSE with decoded previews per step | not available | not available |
| Structured progress | `queue_position` + logs array | tqdm log scraping only | not available |
| Webhooks | ED25519/JWKS signed | HMAC-SHA256 (Svix) | not available |
| True cancellation | raises exception in runner | raises exception in runner | connection close only |
| Dynamic schema discovery | OpenAPI 3.0 per endpoint | OpenAPI 3.1 per model version | static schema |
| LoRA stacking | multi-LoRA endpoints | per-model | not expressible |
| Hardware selection | implicit per model | explicit on deployments | not available |

**Fal auth uses `Key` prefix**, not `Bearer`. Concurrency limit: 2 free, 40 at $1k credits.

**Replicate progress** requires parsing tqdm-style log output with regex (`(\d+)%\|`) - no structured progress field exists. Model versions have individual OpenAPI schemas that define their input/output shapes.

### Variance Traps for Adapter Design

1. **`created` is unreliable** - Ollama returns file mtime, vLLM returns request time. Don't surface as model release date
2. **`owned_by` is meaningless for filtering** - hardcoded per-platform, not per-provider
3. **Image gen endpoint varies** - OpenRouter uses chat completions, OpenAI uses images endpoint, some providers don't support images at all
4. **Vision input format** - Ollama rejects https URLs, only accepts base64 data URIs
5. **NanoGPT model listing is split** - four separate endpoints by modality
6. **`response_format` variance** - gpt-image-1 forces b64_json (must omit field), Ollama/text-gen-webui only support b64_json, OpenAI dall-e supports URL (expires in 1h)
7. **`max_tokens` vs `max_completion_tokens`** - reasoning models reject `max_tokens`
8. **Auth header prefix** - most use `Bearer`, Fal uses `Key`, Ollama accepts anything
9. **Streaming errors** - arrive as SSE events with error JSON, not HTTP status codes (already 200)
10. **Conditional endpoints** - vLLM only registers endpoints matching loaded model's supported tasks. Hitting a non-registered endpoint returns 404

## Architecture

### Executor model

A new executor `execute_cloud` in `enso_api/executors.py` (or a dedicated `enso_api/cloud/executor.py`). It:

1. Reads the provider + model from the job params
2. Identifies the modality (image/llm/audio/video) from model capabilities
3. Delegates to the matching provider adapter
4. Calls the appropriate OpenAI-compatible endpoint
5. Pushes progress via per-job WebSocket
6. Stores result and returns in the same shape as other executors

No `queue_lock` acquisition - cloud jobs run concurrently with local jobs.

### Provider registry

```text
enso_api/cloud/
  __init__.py              # registry: discover + list configured providers
  base.py                  # abstract adapter interface
  openai_compat.py         # OpenAI-compatible adapter (covers all compat providers)
  providers.json           # user's configured providers (base_url + name + enabled)
```

The OpenAI-compatible adapter is parameterized by base URL - not subclassed per provider. Adding OpenRouter vs NanoGPT vs a custom endpoint is just a different `base_url` in config, not new code.

### Live model discovery

Providers expose `/v1/models` which returns model IDs, and often (OpenRouter especially) rich metadata: pricing, context length, modality, capabilities. The adapter:

1. Fetches `/v1/models` on demand (with caching + TTL)
2. Normalizes into Enso's model schema
3. Tags each with provider source, modality, capabilities
4. Frontend model picker renders them alongside local models

This means zero hardcoded model lists - what the provider offers is what Enso shows.

### Frontend routing

`requestBuilder.ts` checks the selected model's `source` field:

- `"local"` - existing pipeline (flatten canvas -> resize -> upload -> build v2 request)
- `"cloud"` - route by modality to the appropriate request builder (image gen, chat completion, etc.)

### Secret storage

API keys live server-side only. Options:

- Environment variables (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`, etc.)
- A JSON file under sdnext's data directory (e.g. `data/enso-cloud.json`)
- Exposed via `/sdapi/v2/cloud/providers` (read: which are configured; never exposes keys)
- Write endpoint for key entry from Settings UI (writes to file, never returns key values)

## Stage 2 Schema - Data Model & Capability Types

### Modality and Capability Types

```typescript
// What a model can produce (broad categories for filtering/routing)
type Modality =
  | "text-to-image" | "image-to-image" | "inpaint"
  | "chat" | "vision"
  | "audio-in" | "audio-out"
  | "text-to-video" | "image-to-video";

// Fine-grained features within a modality (drives UI gating)
type Capability =
  | "streaming" | "tools" | "structured-output"
  | "controlnet" | "ip-adapter" | "lora"
  | "negative-prompt" | "seed" | "guidance"
  | "style" | "quality" | "reasoning";
```

### Unified Model Type (discriminated union)

```typescript
type UnifiedModel = LocalModel | CloudModel;

// Existing local model - unchanged from current SdModelV2
interface LocalModel {
  source: "local";
  title: string;
  model_name: string;
  filename: string;
  type: string;           // pipeline class
  hash: string | null;
  sha256: string | null;
  size: number | null;
  mtime: string | null;
  version: string | null;
  subfolder: string | null;
}

// Cloud model - fetched live from providers
interface CloudModel {
  source: "cloud";
  id: string;                              // provider model ID (e.g. "openai/gpt-5.4-image-2")
  name: string;                            // display name (e.g. "GPT-5.4 Image 2")
  provider: string;                        // configured provider id
  modalities: Modality[];                  // what it can do (broad)
  capabilities: Capability[];              // fine-grained features
  pricing: ModelPricing | null;            // null if provider doesn't expose
  context_length: number | null;           // for LLM models
  supported_params: ParamDescriptor[] | null;  // null = unknown, show all
  // OpenRouter-specific rich metadata (progressive enhancement)
  description: string | null;
  default_params: Record<string, unknown> | null;
}
```

### Model Pricing

```typescript
interface ModelPricing {
  // Per-token (LLM)
  prompt_token?: string;        // USD per token (string to avoid float precision)
  completion_token?: string;
  // Per-unit (image/audio/video)
  per_image?: string;
  per_second?: string;          // audio duration, video duration
  per_request?: string;
  // Cache-aware (OpenRouter)
  cache_read_token?: string;
  cache_write_token?: string;
  // Metadata
  currency: "USD";
}
```

### Parameter Descriptors

```typescript
interface ParamDescriptor {
  name: string;             // "temperature", "guidance", "steps"
  type: "float" | "int" | "string" | "bool" | "enum";
  min?: number;
  max?: number;
  step?: number;
  default?: number | string | boolean;
  options?: string[];       // for enum type (e.g. style: ["vivid", "natural"])
}
```

### Provider Configuration

```typescript
type ProviderPreset =
  | "openrouter" | "openai" | "nanogpt"
  | "aihubmix" | "ollama" | "custom";

// What the user configures
interface ProviderConfig {
  id: string;                   // user-chosen slug or auto-generated
  name: string;                 // display name
  preset: ProviderPreset;       // determines endpoint routing
  base_url: string;             // pre-filled for presets, user-entered for custom
  has_key: boolean;             // true if key is stored (never expose key itself)
  enabled: boolean;
}

// What the backend returns (enriched after probing)
interface Provider extends ProviderConfig {
  status: "ok" | "error" | "unchecked";
  error?: string;
  endpoints: {
    models: boolean;
    chat: boolean;
    images: boolean;
    audio_speech: boolean;
    audio_transcriptions: boolean;
    video: boolean;
  };
  model_count: number;
  last_refreshed: string | null;
}
```

### Provider Presets (declarative, not logic)

```python
PRESETS = {
    "openrouter": {
        "base_url": "https://openrouter.ai/api",
        "image_via": "chat",           # images routed through chat completions
        "model_list": ["/v1/models"],
        "model_list_filters": {"output_modalities": "all"},
        "auth_header": "Bearer",
        "extra_headers": {"HTTP-Referer": "", "X-Title": "Enso"},
    },
    "openai": {
        "base_url": "https://api.openai.com",
        "image_via": "images",         # dedicated /v1/images/generations
        "model_list": ["/v1/models"],
        "auth_header": "Bearer",
    },
    "nanogpt": {
        "base_url": "https://nano-gpt.com/api",
        "image_via": "images",
        "model_list": ["/v1/models", "/v1/image-models", "/v1/video-models", "/v1/audio-models"],
        "auth_header": "Bearer",
    },
    "aihubmix": {
        "base_url": "https://aihubmix.com/v1",
        "image_via": "images",
        "model_list": ["/v1/models"],
        "auth_header": "Bearer",
    },
    "ollama": {
        "base_url": "http://localhost:11434",
        "image_via": "images",
        "model_list": ["/v1/models"],
        "auth_header": None,           # no auth required
        "vision_input": "base64_only", # rejects https URLs
    },
    "custom": {
        "base_url": "",                # user must provide
        "image_via": "probe",          # try images endpoint, fall back to chat
        "model_list": ["/v1/models"],
        "auth_header": "Bearer",
    },
}
```

### Cloud Job Request Types (per-modality)

```typescript
interface CloudImageJobParams {
  type: "cloud_image";
  provider: string;
  model: string;
  prompt: string;
  negative_prompt?: string;
  size?: string;               // "1024x1024" or "landscape_16_9" etc
  n?: number;
  seed?: number;
  guidance?: number;
  steps?: number;
  quality?: string;            // "low" | "medium" | "high" | "auto"
  style?: string;              // "vivid" | "natural"
  // img2img / inpaint
  image?: string;              // base64 or upload ref
  mask?: string;               // base64 or upload ref
  strength?: number;
  // Escape hatch for provider-specific params
  extra_params?: Record<string, unknown>;
  priority?: number;
}

interface CloudChatJobParams {
  type: "cloud_chat";
  provider: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  seed?: number;
  tools?: ToolDef[];
  response_format?: ResponseFormat;
  extra_params?: Record<string, unknown>;
  priority?: number;
}

interface CloudTtsJobParams {
  type: "cloud_tts";
  provider: string;
  model: string;
  input: string;               // text to synthesize
  voice?: string;
  speed?: number;
  response_format?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  priority?: number;
}

interface CloudSttJobParams {
  type: "cloud_stt";
  provider: string;
  model: string;
  audio: string;               // upload ref or base64
  language?: string;           // ISO-639-1
  response_format?: "json" | "text" | "srt" | "vtt";
  priority?: number;
}

interface CloudVideoJobParams {
  type: "cloud_video";
  provider: string;
  model: string;
  prompt: string;
  aspect_ratio?: string;       // "16:9", "9:16", "1:1"
  duration?: number;           // seconds
  size?: string;
  image?: string;              // image-to-video conditioning
  extra_params?: Record<string, unknown>;
  priority?: number;
}
```

### JobResult Extension for Cloud

```typescript
// Existing JobResult handles images already.
// Cloud additions:
interface JobResult {
  images: ImageRef[];           // image gen results (existing)
  processed: ImageRef[];        // post-processed (existing)
  info: Record<string, unknown>;
  params: Record<string, unknown>;
  // Cloud extensions
  text?: string;                // chat completion response
  audio?: AudioRef;             // TTS output
  video?: VideoRef;             // video output
  usage?: CloudUsage;           // token/cost tracking
}

interface AudioRef {
  url: string;
  format: string;
  duration: number | null;
  size: number;
}

interface VideoRef {
  url: string;
  format: string;
  duration: number | null;
  size: number;
  thumbnail?: string;
}

interface CloudUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;               // USD
  provider: string;
  model: string;
}
```

### WebSocket Events for Cloud Jobs

```typescript
// Extends existing JobWsEvent union with cloud-specific phases
type CloudJobPhase = "queued" | "submitted" | "running" | "downloading" | "processing";

// New event variant in the union:
| { type: "cloud_progress"; phase: CloudJobPhase; detail?: string;
    position?: number; elapsed?: number; download_progress?: number }
```

### Python Pydantic Equivalents

The Python side mirrors these types in `enso_api/models.py`:

```python
class CloudModelItem(BaseModel):
    source: Literal["cloud"] = "cloud"
    id: str
    name: str
    provider: str
    modalities: list[str]
    capabilities: list[str]
    pricing: dict | None = None
    context_length: int | None = None
    supported_params: list[dict] | None = None
    description: str | None = None
    default_params: dict | None = None

class ProviderConfig(BaseModel):
    id: str
    name: str
    preset: str
    base_url: str
    has_key: bool
    enabled: bool

class ProviderStatus(ProviderConfig):
    status: Literal["ok", "error", "unchecked"] = "unchecked"
    error: str | None = None
    endpoints: dict = Field(default_factory=dict)
    model_count: int = 0
    last_refreshed: str | None = None
```

## Stage 3 Design - Provider Adapter Interface

### Architecture Decisions

- **Protocol + Composition**: Protocol defines the adapter contract (structural typing). Shared HTTP machinery lives in an injected `HttpTransport` class. Adapters receive a transport instance and satisfy the Protocol without inheritance.
- **Executor declares lock requirement**: EXECUTORS dict carries `{fn, lock: bool}`. Cloud executors set `lock=False` and run concurrently.
- **Callback for progress**: Adapter receives an `on_progress(data: dict)` callback, calls it to push status updates. No coupling to job queue internals.
- **Exception hierarchy for errors**: Small set of typed exceptions (6 classes). Executor catches by type and responds appropriately.
- **Async thread pool**: Cloud worker threads have a persistent event loop. Adapter methods are `async def`, run natively. True async with connection reuse and concurrent operations within a job.

### Protocol Definition

```python
from typing import Protocol, Callable

class ProviderAdapter(Protocol):
    config: ProviderConfig

    async def list_models(self) -> list[CloudModelItem]:
        """Fetch available models from this provider. Uses cache when fresh."""
        ...

    async def generate_image(
        self, params: dict, on_progress: Callable[[dict], None]
    ) -> ImageResult:
        """Submit image generation, poll/stream progress, return result."""
        ...

    async def chat(
        self, params: dict, on_progress: Callable[[dict], None]
    ) -> ChatResult:
        """Submit chat completion, stream tokens, return result."""
        ...

    async def tts(self, params: dict) -> AudioResult:
        """Text-to-speech. Typically one-shot, no progress needed."""
        ...

    async def transcribe(self, params: dict) -> TranscribeResult:
        """Speech-to-text. One-shot."""
        ...

    async def generate_video(
        self, params: dict, on_progress: Callable[[dict], None]
    ) -> VideoResult:
        """Submit video generation, poll progress, return result."""
        ...

    async def cancel(self, remote_id: str) -> bool:
        """Attempt to cancel a running remote job. Returns success."""
        ...

    async def probe_endpoints(self) -> dict[str, bool]:
        """Discover which endpoints this provider supports."""
        ...

    async def validate_key(self) -> bool:
        """Test if the configured API key is valid."""
        ...
```

### HttpTransport (shared machinery)

```python
import httpx

class HttpTransport:
    """Shared HTTP concerns: connection pool, retry, caching, rate tracking."""

    def __init__(self, config: ProviderConfig, preset: dict):
        self.config = config
        self.preset = preset
        self.client = httpx.AsyncClient(
            base_url=config.base_url,
            headers=self._build_headers(),
            timeout=httpx.Timeout(connect=10, read=120, write=30, pool=10),
        )
        self._model_cache: list[dict] | None = None
        self._cache_expires: float = 0
        self._rate_limit_remaining: int | None = None
        self._rate_limit_reset: float | None = None

    def _build_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        auth_type = self.preset.get("auth_header")
        if auth_type and self.config.has_key:
            # Key loaded from secure storage at construction time
            headers["Authorization"] = f"{auth_type} {self._load_key()}"
        for k, v in self.preset.get("extra_headers", {}).items():
            if v:
                headers[k] = v
        return headers

    async def get(self, path: str, params: dict | None = None) -> dict:
        """GET with retry on transient errors."""
        ...

    async def post(self, path: str, json: dict | None = None, **kw) -> dict:
        """POST with retry on transient errors."""
        ...

    async def post_stream(self, path: str, json: dict) -> httpx.Response:
        """POST returning a streaming response for SSE consumption."""
        ...

    async def get_cached(self, path: str, ttl: int = 300, **kw) -> dict:
        """GET with in-memory TTL cache."""
        ...

    async def upload_file(self, path: str, file_data: bytes, **kw) -> dict:
        """Multipart file upload."""
        ...

    def update_rate_limits(self, headers: httpx.Headers) -> None:
        """Parse x-ratelimit-* headers from response."""
        ...

    async def close(self) -> None:
        """Shutdown connection pool."""
        await self.client.aclose()
```

### Exception Hierarchy

```python
class CloudError(Exception):
    """Base for all cloud adapter errors."""
    def __init__(self, message: str, provider: str, status: int | None = None):
        super().__init__(message)
        self.provider = provider
        self.status = status

class AuthError(CloudError):
    """401 - Invalid or missing API key."""

class QuotaError(CloudError):
    """402 - Insufficient credits or balance."""

class RateLimitError(CloudError):
    """429 - Rate limited. Check retry_after."""
    def __init__(self, message: str, provider: str, retry_after: float | None = None, **kw):
        super().__init__(message, provider, status=429, **kw)
        self.retry_after = retry_after

class ContentFilterError(CloudError):
    """403 - Content policy violation."""

class ModelNotFoundError(CloudError):
    """404 - Model ID not recognized by provider."""

class ProviderError(CloudError):
    """500/502/503 - Transient upstream failure. Safe to retry."""
```

### Result Types

```python
from dataclasses import dataclass

@dataclass
class ImageResult:
    images: list[bytes]            # raw image bytes (PNG/JPEG/WebP)
    revised_prompt: str | None     # model-rewritten prompt (dall-e-3, gpt-image)
    format: str                    # "png", "jpeg", "webp"
    usage: CloudUsage | None

@dataclass
class ChatResult:
    content: str                   # assistant response text
    tool_calls: list[dict] | None  # if tool use was triggered
    finish_reason: str             # "stop", "tool_calls", "length"
    usage: CloudUsage | None

@dataclass
class AudioResult:
    data: bytes                    # raw audio bytes
    format: str                    # "mp3", "opus", "wav", etc.
    duration: float | None

@dataclass
class TranscribeResult:
    text: str
    language: str | None
    segments: list[dict] | None    # timestamped segments if available
    duration: float | None

@dataclass
class VideoResult:
    data: bytes                    # raw video bytes
    format: str                    # "mp4"
    duration: float | None
    thumbnail: bytes | None

@dataclass
class CloudUsage:
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    cost: float | None = None      # USD
```

### Executor Integration

```python
# In EXECUTORS dict:
EXECUTORS = {
    'generate': {'fn': execute_generate, 'lock': True},
    'upscale': {'fn': execute_upscale, 'lock': True},
    # ... existing local executors ...
    'cloud_image': {'fn': execute_cloud_image, 'lock': False},
    'cloud_chat': {'fn': execute_cloud_chat, 'lock': False},
    'cloud_tts': {'fn': execute_cloud_tts, 'lock': False},
    'cloud_stt': {'fn': execute_cloud_stt, 'lock': False},
    'cloud_video': {'fn': execute_cloud_video, 'lock': False},
}

# Cloud executor entry point (runs in async thread pool):
def execute_cloud_image(params: dict, job_id: str) -> dict:
    """Bridge: runs async adapter in the cloud thread's event loop."""
    loop = _get_thread_event_loop()
    return loop.run_until_complete(_async_cloud_image(params, job_id))

async def _async_cloud_image(params: dict, job_id: str) -> dict:
    from enso_api.cloud import get_adapter
    adapter = get_adapter(params['provider'])
    
    def on_progress(data: dict):
        job_queue._push_progress(job_id, data)
    
    result = await adapter.generate_image(params, on_progress)
    # Save images to job output dir, return standard result dict
    return _save_image_result(result, job_id)
```

### Provider Registry

```python
# enso_api/cloud/__init__.py

_adapters: dict[str, ProviderAdapter] = {}

def init_providers(config_path: str) -> None:
    """Load provider configs and instantiate adapters."""
    configs = load_provider_configs(config_path)
    for cfg in configs:
        if cfg.enabled:
            preset = PRESETS.get(cfg.preset, PRESETS["custom"])
            transport = HttpTransport(cfg, preset)
            adapter = OpenAICompatAdapter(cfg, transport)
            _adapters[cfg.id] = adapter

def get_adapter(provider_id: str) -> ProviderAdapter:
    """Get adapter for a configured provider. Raises if not found/disabled."""
    adapter = _adapters.get(provider_id)
    if adapter is None:
        raise ValueError(f"Provider not configured or disabled: {provider_id}")
    return adapter

def list_providers() -> list[ProviderStatus]:
    """Return all configured providers with their status."""
    ...

async def refresh_models(provider_id: str) -> list[CloudModelItem]:
    """Force-refresh model list for a provider."""
    ...
```

### File Layout

```text
enso_api/cloud/
    __init__.py          # registry (init_providers, get_adapter, list_providers)
    protocol.py          # ProviderAdapter Protocol + result types
    transport.py         # HttpTransport (shared HTTP machinery)
    errors.py            # CloudError hierarchy
    openai_compat.py     # OpenAICompatAdapter (satisfies Protocol)
    presets.py           # PRESETS dict
    executor.py          # execute_cloud_* functions + async thread pool setup
```

## Stage 4 Design - Parameter Mapping Strategy

### Architecture Decisions

- **Hybrid approach**: Frontend gates visibility (show/hide controls based on model's `supported_params`). Backend adapter translates Enso param names to provider API names. Neither does both jobs.
- **Local-only params hidden entirely**: When a cloud model is selected, tabs/sections that are fully local-only (Hires, Refiner, Detailer, Advanced optimizations) disappear. Clean UI, no confusion.
- **Per-preset mapping overrides**: Each preset carries its own param translation map. Base adapter has defaults, presets override where their provider diverges.

### Parameter Tiers

| Tier | Examples | Cloud behavior |
| --- | --- | --- |
| **1 - Universal** | prompt, negative_prompt, width/height, seed, steps, guidance, batch_size | Translated to provider names via preset map |
| **2 - Provider-specific** | quality, style (OpenAI), denoising_strength (img2img) | Present in some presets' maps, absent in others |
| **3 - Local-only** | hires_*, refiner_*, detailer_*, hypertile_*, teacache_*, freeU_*, token_merging, color_correction, sampler tuning, clip_skip, VAE type | Never sent. Hidden in UI when cloud model selected |

### Frontend Param Visibility

The model's `supported_params: ParamDescriptor[]` uses Enso-native naming. The frontend reads this to determine which controls to render:

```typescript
// In parameter tab components:
const model = useSelectedModel(); // UnifiedModel
const isCloud = model?.source === "cloud";

// Hide entire tabs when cloud model selected and no params from that tab are supported
const showHiresTab = !isCloud; // always local-only
const showRefineTab = !isCloud;
const showDetailTab = !isCloud;
const showAdvancedTab = !isCloud || hasAnySupportedParam(model, ADVANCED_PARAMS);

// Within visible tabs, show/hide individual params:
const showSteps = !isCloud || isParamSupported(model, "steps");
const showGuidance = !isCloud || isParamSupported(model, "cfgScale");
const showNegative = !isCloud || isParamSupported(model, "negativePrompt");
```

### Backend Param Translation

The adapter uses a preset-specific mapping to translate Enso params into provider API params:

```python
# In presets.py - each preset defines its param translation

DEFAULT_IMAGE_PARAMS = {
    # Enso name -> (API name, optional transform)
    "prompt": ("prompt", None),
    "negativePrompt": ("negative_prompt", None),
    "cfgScale": ("guidance_scale", lambda v: max(1.0, min(20.0, v))),
    "steps": ("num_inference_steps", lambda v: max(1, min(150, v))),
    "seed": ("seed", lambda v: v if v >= 0 else None),
    "batchSize": ("n", lambda v: max(1, min(10, v))),
    "denoisingStrength": ("strength", None),
}

PRESETS = {
    "openrouter": {
        # ...existing fields...
        "param_maps": {
            "image": {
                # OpenRouter sends images via chat completions - different shape entirely
                # Only prompt goes in messages; size/quality go as top-level params
                "prompt": ("_message_content", None),  # special: goes into messages array
                "width": None,   # handled by size_transform
                "height": None,
                "batchSize": ("n", None),
                "seed": ("seed", None),
            },
            "image_size_transform": lambda w, h: {"size": f"{w}x{h}"},
            "chat": DEFAULT_CHAT_PARAMS,
        },
    },
    "openai": {
        "param_maps": {
            "image": {
                **DEFAULT_IMAGE_PARAMS,
                "quality": ("quality", None),     # OpenAI-specific
                "style": ("style", None),         # OpenAI-specific
                "width": None,
                "height": None,
            },
            "image_size_transform": lambda w, h: {"size": f"{w}x{h}"},
            "chat": DEFAULT_CHAT_PARAMS,
        },
    },
    "ollama": {
        "param_maps": {
            "image": {
                "prompt": ("prompt", None),
                "batchSize": None,  # Ollama doesn't support n
                "width": None,
                "height": None,
            },
            "image_size_transform": lambda w, h: {"size": f"{w}x{h}"},
            "chat": {
                **DEFAULT_CHAT_PARAMS,
                # Ollama doesn't support: tool_choice, logit_bias, user, n
            },
        },
    },
    "custom": {
        "param_maps": {
            # Default maps - custom endpoints assumed to be OpenAI-like
            "image": DEFAULT_IMAGE_PARAMS,
            "image_size_transform": lambda w, h: {"size": f"{w}x{h}"},
            "chat": DEFAULT_CHAT_PARAMS,
        },
    },
}
```

### Translation Flow

```python
# In the adapter's generate_image method:
async def generate_image(self, params: dict, on_progress) -> ImageResult:
    param_map = self.preset["param_maps"]["image"]
    size_fn = self.preset["param_maps"].get("image_size_transform")
    
    # Translate params
    api_params = {}
    for enso_name, value in params.items():
        if enso_name in ("provider", "model", "type", "priority", "extra_params"):
            continue  # routing fields, not generation params
        mapping = param_map.get(enso_name)
        if mapping is None:
            continue  # unmapped = not supported by this provider
        api_name, transform = mapping if isinstance(mapping, tuple) else (mapping, None)
        if api_name is None:
            continue  # explicitly suppressed
        api_params[api_name] = transform(value) if transform else value
    
    # Apply structural transforms (width+height -> size)
    if size_fn and "width" in params and "height" in params:
        api_params.update(size_fn(params["width"], params["height"]))
    
    # Merge extra_params (escape hatch for provider-specific params)
    if params.get("extra_params"):
        api_params.update(params["extra_params"])
    
    # Remove None values (seed=-1 transformed to None means "don't send")
    api_params = {k: v for k, v in api_params.items() if v is not None}
    
    # Route to correct endpoint based on preset
    return await self._submit_image(api_params, on_progress)
```

### ParamDescriptor Population

The adapter translates in the reverse direction too: when fetching models and building `supported_params`, it maps provider param names back to Enso names:

```python
# Reverse map: API param name -> Enso ParamDescriptor
def build_supported_params(self, provider_params: list[str] | None) -> list[dict] | None:
    if provider_params is None:
        return None  # unknown = show all
    
    reverse_map = self._build_reverse_map()  # API name -> Enso name + schema
    descriptors = []
    for api_param in provider_params:
        if api_param in reverse_map:
            descriptors.append(reverse_map[api_param])
    return descriptors or None
```

### Tabs Hidden for Cloud Models

| Tab | Cloud behavior |
| --- | --- |
| **Prompts** | Shown (prompt + negative always relevant) |
| **Sampler** | Hidden (cloud APIs don't expose scheduler choice) unless model has `steps` in supported_params, then show steps only |
| **Guidance** | Shown if model supports cfgScale/seed |
| **Refine** | Hidden (local-only: refiner pipeline) |
| **Detail** | Hidden (local-only: detailer pipeline) |
| **Advanced** | Hidden (local-only: clip_skip, VAE, hypertile, teacache, FreeU, token merging) |
| **Color** | Hidden (local-only: color correction, HDR) |
| **Input** | Shown if model supports img2img/inpaint |
| **Scripts** | Hidden (local-only: SD.Next scripts) |

## Stage 8 Design - Mixed Workflows & Edge Cases

### Architecture Decisions

- **Cloud-to-local chains work already**. Same "send to upscale" pattern. No new architecture.
- **No automatic fallback**. Show error with "Try local" button. User decides. Automatic fallback could trigger unexpected model loads.
- **Comparison mode and batch across providers are v2 scope**. Not architecturally blocked, just need UX design.
- **Always download result images locally**. Provider URLs expire. Adapter saves bytes to job output dir. JobResult never references remote URLs.
- **Mask convention normalization in adapter**. OpenAI: transparent=editable. Other providers may differ. Adapter converts at submission time.

### v1 Scope vs Future

| Feature | v1 | Future |
| --- | --- | --- |
| txt2img via cloud | Yes | - |
| img2img via cloud | Yes (if model supports) | - |
| Inpaint via cloud | Yes (if model supports) | - |
| Cloud -> local upscale | Yes (existing "send to" flow) | - |
| Local -> cloud upscale | Yes (if provider supports edits) | - |
| LLM chat | Yes | - |
| TTS | Yes | - |
| STT | Yes | - |
| Video generation | Yes | - |
| ControlNet via cloud | No | Via Fal/Replicate native adapters |
| IP-Adapter via cloud | No | Via Fal/Replicate native adapters |
| Comparison mode (cloud vs local) | No | v2 - submit two jobs, side-by-side view |
| Batch split across providers | No | v2 - UX for splitting batch_size |
| Automatic fallback | No | Intentional - user should decide |
| Provider cost tracking/dashboard | No | v2 - aggregate CloudUsage from job results |

### Canvas Pipeline for Cloud img2img/Inpaint

```text
Cloud img2img flow:
Canvas layers → flattenCanvas() → resizeCanvas() → upload to staging
    → adapter receives image ref → base64-encodes or re-uploads to provider
    → provider returns result → adapter downloads → saves to job output dir
    → frontend displays via standard /jobs/{id}/images/{index}

Cloud inpaint flow:
Same as above, plus:
    → exportMask() produces mask image
    → adapter normalizes mask convention (invert if provider expects opposite)
    → both image and mask sent to provider's edit/inpaint endpoint
```

The WYSIWYG invariant is preserved: what the user sees in the canvas frame is what gets sent, regardless of local or cloud.

### Metadata in Job Results

```python
# Cloud executor adds provider info to result.info:
result_info = {
    "cloud_provider": params["provider"],
    "cloud_model": params["model"],
    "cloud_cost": usage.cost if usage else None,
    "cloud_tokens": {
        "prompt": usage.prompt_tokens,
        "completion": usage.completion_tokens,
    } if usage else None,
    "revised_prompt": image_result.revised_prompt,  # dall-e/gpt-image
    # Standard fields
    "prompt": params.get("prompt"),
    "negative_prompt": params.get("negative_prompt"),
    "seed": params.get("seed"),
    "width": width,
    "height": height,
}
```

### Error UX

```text
Cloud job fails:
    │
    ├── AuthError → "API key invalid. Check provider settings." + link to settings
    ├── QuotaError → "Insufficient credits on {provider}." + link to provider dashboard
    ├── RateLimitError → "Rate limited. Retrying in {n}s..." (auto-retry once)
    ├── ContentFilterError → "Content blocked by provider's safety filter."
    ├── ModelNotFoundError → "Model {id} no longer available." + refresh models button
    └── ProviderError → "Provider error: {message}. Try again?" + retry button
```

Each error type maps to a specific toast with actionable guidance, not a generic "generation failed."

### Edge Cases

**Model removed while selected:** If the user's selected cloud model disappears from the provider's catalog on next refresh, the modelSelectionStore still holds the stale selection. On next generation attempt, the adapter gets `ModelNotFoundError`. The toast shows "Model no longer available" with a button to refresh and reselect. The stale selection is cleared.

**Provider disabled while jobs running:** Running cloud jobs should complete or fail naturally. The adapter instance stays alive until all in-flight jobs finish. New submissions to the disabled provider are rejected at the route level.

**Network loss during cloud job:** httpx timeout fires after the configured timeout. HttpTransport retries transient errors (up to 3). If all retries fail, job fails with a clear "Connection lost" error. No zombie jobs - the timeout ensures termination.

**Multiple providers with same model:** OpenRouter and OpenAI both offer GPT-Image. They appear as separate entries in different provider groups. The user explicitly picks which provider to use. No deduplication or smart routing in v1.

## Stage 7 Design - Frontend Integration

### Architecture Decisions

- **modelSelectionStore** (new Zustand store): Single source of truth for active model (local or cloud). Holds a `UnifiedModel` discriminated union. Local model loading triggered as side effect on selection. Syncs from SD.Next options on startup.
- **Separate CommandGroups in model picker**: Local models and cloud models appear in distinct sections, cloud grouped by provider. Provider badge + pricing hint on each cloud entry.
- **Local-only tabs hidden entirely** when cloud model selected (from Stage 4).
- **Progress display shows phase text** for cloud jobs instead of step/steps count.
- **Result handling unchanged**: cloud results save to same output dir, serve via same image endpoint. Frontend doesn't differentiate.

### modelSelectionStore

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UnifiedModel, LocalModel, CloudModel } from "@/api/types/models";

interface ModelSelectionState {
  activeModel: UnifiedModel | null;
  // Derived convenience
  isCloud: boolean;
  cloudModelId: string | null;
  cloudProvider: string | null;
  localModelTitle: string | null;
}

interface ModelSelectionActions {
  selectLocal: (model: LocalModel) => void;
  selectCloud: (model: CloudModel) => void;
  clear: () => void;
}

export const useModelSelectionStore = create<ModelSelectionState & ModelSelectionActions>()(
  persist(
    (set) => ({
      activeModel: null,
      isCloud: false,
      cloudModelId: null,
      cloudProvider: null,
      localModelTitle: null,

      selectLocal: (model) => {
        set({
          activeModel: model,
          isCloud: false,
          cloudModelId: null,
          cloudProvider: null,
          localModelTitle: model.title,
        });
        // Side effect: trigger SD.Next model load
        // (handled by a hook that watches this store)
      },

      selectCloud: (model) => {
        set({
          activeModel: model,
          isCloud: true,
          cloudModelId: model.id,
          cloudProvider: model.provider,
          localModelTitle: null,
        });
      },

      clear: () => set({
        activeModel: null,
        isCloud: false,
        cloudModelId: null,
        cloudProvider: null,
        localModelTitle: null,
      }),
    }),
    { name: "enso-model-selection" }
  )
);
```

### Model Picker Changes

```tsx
// ModelSelector.tsx - extended with cloud models
export function ModelSelector() {
  const { data: localModels } = useModelList();
  const { data: cloudModels } = useCloudModels();  // new hook
  const { activeModel, selectLocal, selectCloud } = useModelSelectionStore();

  return (
    <Popover>
      {/* ... trigger button shows activeModel name ... */}
      <PopoverContent>
        <Command>
          <CommandInput placeholder="Search models..." />
          <CommandList>
            {/* Local models */}
            <CommandGroup heading="Local">
              {localModels?.map((model) => (
                <CommandItem onSelect={() => selectLocal(model)}>
                  {model.title}
                </CommandItem>
              ))}
            </CommandGroup>

            {/* Cloud models grouped by provider */}
            {cloudModels?.providers.map((provider) => (
              <CommandGroup key={provider.id} heading={provider.name}>
                {provider.models.map((model) => (
                  <CommandItem onSelect={() => selectCloud(model)}>
                    <span>{model.name}</span>
                    {model.pricing && (
                      <span className="text-3xs text-muted-foreground">
                        {formatPricing(model.pricing)}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

### New Hook: useCloudModels

```typescript
// src/api/hooks/useCloudModels.ts
export function useCloudModels() {
  return useQuery({
    queryKey: ["cloud-models"],
    queryFn: async () => {
      const providers = await api.get<Provider[]>("/sdapi/v2/cloud/providers");
      // Only fetch models for enabled providers with valid keys
      const active = providers.filter(p => p.enabled && p.status === "ok");
      const results = await Promise.all(
        active.map(async (p) => ({
          ...p,
          models: await api.get<CloudModel[]>(`/sdapi/v2/cloud/providers/${p.id}/models`),
        }))
      );
      return { providers: results };
    },
    staleTime: 300_000, // 5 min cache
  });
}
```

### requestBuilder Integration

```typescript
// In src/lib/requestBuilder.ts
export async function buildRequest(state: GenerationState): Promise<JobRequest> {
  const { activeModel, isCloud } = useModelSelectionStore.getState();

  if (isCloud && activeModel?.source === "cloud") {
    return buildCloudImageRequest(state, activeModel);
  }
  return buildLocalRequest(state); // existing path unchanged
}

function buildCloudImageRequest(state: GenerationState, model: CloudModel): CloudImageJobParams {
  return {
    type: "cloud_image",
    provider: model.provider,
    model: model.id,
    prompt: state.prompt,
    negative_prompt: state.negativePrompt || undefined,
    size: `${state.width}x${state.height}`,
    seed: state.seed >= 0 ? state.seed : undefined,
    n: state.batchSize,
    guidance: state.cfgScale,
    steps: state.steps,
    // img2img: flatten canvas if init image exists
    image: await getInitImageIfNeeded(state, model),
    mask: await getMaskIfNeeded(state, model),
    strength: state.denoisingStrength,
    extra_params: state.extraCloudParams || undefined,
  };
}
```

### Progress Display for Cloud Jobs

```tsx
// In job progress component:
function JobProgress({ event }: { event: JobWsEvent }) {
  if (event.type === "cloud_progress") {
    const phaseLabels: Record<string, string> = {
      submitted: "Submitting...",
      queued_remote: `In queue${event.position ? ` (#${event.position})` : ""}`,
      processing: "Generating...",
      downloading: "Downloading result...",
    };
    return (
      <div className="flex items-center gap-2">
        <span className="text-2xs">{phaseLabels[event.phase] ?? event.phase}</span>
        {event.progress > 0 && (
          <Progress value={event.progress * 100} />
        )}
      </div>
    );
  }
  // ... existing local progress rendering (step/steps)
}
```

### Startup Sync

On app load, the modelSelectionStore needs to sync with SD.Next's current model state:

```typescript
// In a root-level hook (e.g. useModelSync):
function useModelSync() {
  const { data: checkpoint } = useCurrentCheckpoint();
  const { data: localModels } = useModelList();
  const { activeModel, selectLocal } = useModelSelectionStore();

  useEffect(() => {
    // If no active model in store but SD.Next has one loaded, sync it
    if (!activeModel && checkpoint?.title && localModels) {
      const match = localModels.find(m => m.title === checkpoint.title);
      if (match) selectLocal(match);
    }
  }, [checkpoint, localModels, activeModel]);
}
```

### Tab Visibility Hook

```typescript
// src/hooks/useCloudModelGating.ts
export function useCloudModelGating() {
  const { activeModel, isCloud } = useModelSelectionStore();
  const cloudModel = isCloud ? (activeModel as CloudModel) : null;

  return {
    isCloud,
    showTab: (tab: string) => {
      if (!isCloud) return true; // local model: show everything
      // Cloud: only show tabs that have at least one supported param
      const tabParams = TAB_PARAM_MAPPING[tab];
      if (!tabParams) return false;
      if (!cloudModel?.supported_params) return true; // unknown = show all
      return tabParams.some(p =>
        cloudModel.supported_params!.some(sp => sp.name === p)
      );
    },
  };
}

const TAB_PARAM_MAPPING: Record<string, string[]> = {
  prompts: ["prompt", "negativePrompt"],
  sampler: ["steps", "sampler"],
  guidance: ["cfgScale", "seed", "denoisingStrength"],
  refine: [],     // always local-only
  detail: [],     // always local-only
  advanced: [],   // always local-only
  color: [],      // always local-only
  input: ["denoisingStrength", "image", "mask"],
  scripts: [],    // always local-only
};
```

## Stage 6 Design - Secret Management & Provider Configuration

### Architecture Decisions

- **JSON file at `{enso_root}/cloud-providers.json`**. Same locality as `jobs.db`. Gitignored. Contains provider configs + API keys.
- **Plaintext keys** (same security model as SD.Next's own API key in `config.json`). Filesystem access = game over anyway. No encryption theatre.
- **Write-only API for keys**. POST to set, DELETE to remove. Status endpoint returns `has_key: bool`, never the actual value.
- **Validation on add**. Probe the provider immediately to confirm the key works.
- **Onboarding via preset list + custom**. Settings UI shows known providers with "Add" buttons. Pre-filled base_url for presets.

### Storage Format

```json
// {enso_root}/cloud-providers.json
{
  "providers": [
    {
      "id": "openrouter-1",
      "name": "OpenRouter",
      "preset": "openrouter",
      "base_url": "https://openrouter.ai/api",
      "key": "sk-or-v1-abc123...",
      "enabled": true
    },
    {
      "id": "my-ollama",
      "name": "Local Ollama",
      "preset": "ollama",
      "base_url": "http://localhost:11434",
      "key": "",
      "enabled": true
    },
    {
      "id": "custom-vllm",
      "name": "Work vLLM",
      "preset": "custom",
      "base_url": "http://192.168.1.50:8000",
      "key": "my-vllm-key",
      "enabled": true
    }
  ]
}
```

### API Endpoints

```text
GET  /sdapi/v2/cloud/providers
  → [{id, name, preset, base_url, has_key, enabled, status, endpoints, model_count, last_refreshed}]
  Never returns key values.

POST /sdapi/v2/cloud/providers
  Body: {name, preset, base_url, key}
  → Creates provider, validates key, returns provider status.
  Auto-generates id from name slug.

PUT  /sdapi/v2/cloud/providers/{id}
  Body: {name?, base_url?, key?, enabled?}
  → Updates provider config. Re-validates if key or base_url changed.

DELETE /sdapi/v2/cloud/providers/{id}
  → Removes provider and its key.

POST /sdapi/v2/cloud/providers/{id}/refresh
  → Force-refreshes model list. Returns updated model count.

POST /sdapi/v2/cloud/providers/{id}/validate
  → Re-validates the stored key. Returns {valid: bool, error?: string}.
```

### Key Validation Flow

```python
async def validate_provider(config: ProviderConfig) -> tuple[bool, str | None]:
    """Probe the provider to confirm key is valid and endpoint is reachable."""
    transport = HttpTransport(config, PRESETS[config.preset])
    try:
        # Try the lightest endpoint available
        await transport.get("/v1/models", params={"limit": "1"})
        return True, None
    except AuthError as e:
        return False, f"Authentication failed: {e}"
    except CloudError as e:
        return False, f"Provider error: {e}"
    except Exception as e:
        return False, f"Connection failed: {e}"
    finally:
        await transport.close()
```

### Environment Variable Override

For deployment scenarios (Docker, CI), keys can be provided via environment variables that take precedence over the JSON file:

```python
ENV_KEY_MAP = {
    "openrouter": "OPENROUTER_API_KEY",
    "openai": "OPENAI_API_KEY",
    "nanogpt": "NANOGPT_API_KEY",
    "aihubmix": "AIHUBMIX_API_KEY",
}

def resolve_key(config: ProviderConfig) -> str:
    """Resolve API key: env var takes precedence over stored value."""
    env_var = ENV_KEY_MAP.get(config.preset)
    if env_var:
        env_val = os.environ.get(env_var)
        if env_val:
            return env_val
    return config.key
```

### Provider Lifecycle

```text
User adds provider in Settings UI
    │
    ▼
POST /sdapi/v2/cloud/providers {name, preset, base_url, key}
    │
    ▼
Backend validates key (probe /v1/models)
    │
    ├── Success: save to JSON, create adapter instance, return status="ok"
    │
    └── Failure: return error message, don't save (user can retry or fix key)
    │
    ▼ (on success)
Adapter fetches full model list, caches it
    │
    ▼
Models appear in frontend model picker (merged with local models)
```

### Security Considerations

- JSON file is gitignored (add to `.gitignore` if not already)
- Keys never returned via GET endpoints
- Keys never logged (HttpTransport redacts Authorization header in error messages)
- Frontend never sees keys (only `has_key: bool`)
- SD.Next's own auth layer (`--auth` flag) protects the v2 API from unauthorized access
- File permissions: created with 0600 (owner read/write only)

## Stage 5 Design - Job Lifecycle & Execution

### Architecture Decisions

- **Polling for progress** (not webhooks). SD.Next runs on localhost behind NAT; webhooks require public reachability. Polling universally works. Future optimization only.
- **Best-effort cancellation**. Mark local job cancelled immediately. Fire-and-forget remote cancel attempt. Don't block.
- **Per-modality timeouts with provider override**. Different modalities have different expected durations. Presets can override defaults.
- **Retry transient errors only**. Max 3 attempts with exponential backoff for 500/502/503. Respect retry_after for 429 (max 1 retry). All other errors fail immediately.
- **Thread pool of 8 workers**. I/O-bound cloud jobs are cheap to run concurrently. Rate limiting handled in HttpTransport, not by limiting concurrency.
- **Existing JobStatus enum unchanged**. Cloud phases (submitted/queued_remote/processing/downloading) live in WS progress events, not DB status.
- **Worker loop dispatches cloud jobs to pool non-blocking**. Local jobs: inline, serial, queue_lock. Cloud jobs: submit to pool, loop immediately.

### Worker Loop Modification

```python
def _execute_job(self, job: dict) -> None:
    job_id = job['id']
    job_type = job['type']
    from enso_api.executors import EXECUTORS
    entry = EXECUTORS.get(job_type)
    
    if entry is None:
        self.store.update_status(job_id, 'failed', error=f"Unknown type: {job_type}")
        return
    
    if entry['lock']:
        # Local job: existing serial behavior with queue_lock
        self._run_local_job(job, entry['fn'])
    else:
        # Cloud job: submit to thread pool, don't block
        self._cloud_pool.submit(self._run_cloud_job, job, entry['fn'])
        # Immediately check for more pending jobs
        if self.store.next_pending():
            self._job_event.set()
```

### Cloud Job Execution Flow

```python
def _run_cloud_job(self, job: dict, executor_fn) -> None:
    """Runs in cloud thread pool with its own event loop."""
    job_id = job['id']
    self.store.update_status(job_id, 'running', started_at=JobStore.now())
    self._push_progress(job_id, {'type': 'status', 'status': 'running'})
    
    try:
        result = executor_fn(job.get('params', {}), job_id)
        self.store.update_status(job_id, 'completed', completed_at=JobStore.now(), result=json.dumps(result))
        self._push_progress(job_id, {'type': 'completed', 'result': result})
    except CloudError as e:
        error_msg = f'{type(e).__name__}: {e}'
        self.store.update_status(job_id, 'failed', completed_at=JobStore.now(), error=error_msg)
        self._push_progress(job_id, {'type': 'error', 'error': error_msg})
    except Exception as e:
        error_msg = f'{type(e).__name__}: {e}'
        self.store.update_status(job_id, 'failed', completed_at=JobStore.now(), error=error_msg)
        self._push_progress(job_id, {'type': 'error', 'error': error_msg})
```

### Timeout Configuration

```python
DEFAULT_TIMEOUTS = {
    "cloud_image": 120,      # 2 minutes
    "cloud_chat": 120,       # 2 minutes (streaming keeps alive)
    "cloud_tts": 30,         # 30 seconds
    "cloud_stt": 60,         # 1 minute
    "cloud_video": 600,      # 10 minutes (video gen is slow)
}

# Presets can override:
PRESETS = {
    "openrouter": {
        # ...
        "timeouts": {
            "cloud_video": 900,  # OpenRouter video can take 15min
        },
    },
}
```

### Retry Logic (in HttpTransport)

```python
async def _request_with_retry(self, method: str, path: str, **kw) -> httpx.Response:
    max_attempts = 3
    backoff = 1.0  # seconds
    
    for attempt in range(max_attempts):
        try:
            response = await self.client.request(method, path, **kw)
            self.update_rate_limits(response.headers)
            
            if response.status_code == 429:
                retry_after = self._parse_retry_after(response.headers)
                if attempt < 1 and retry_after and retry_after < 60:
                    await asyncio.sleep(retry_after)
                    continue
                raise RateLimitError(
                    response.json().get("error", {}).get("message", "Rate limited"),
                    provider=self.config.id,
                    retry_after=retry_after,
                )
            
            if response.status_code in (500, 502, 503) and attempt < max_attempts - 1:
                await asyncio.sleep(backoff * (2 ** attempt))
                continue
            
            # Map other error codes to exceptions
            if response.status_code >= 400:
                self._raise_for_status(response)
            
            return response
        
        except httpx.TimeoutException:
            if attempt < max_attempts - 1:
                await asyncio.sleep(backoff * (2 ** attempt))
                continue
            raise ProviderError("Request timed out", provider=self.config.id)
        
        except httpx.ConnectError:
            if attempt < max_attempts - 1:
                await asyncio.sleep(backoff * (2 ** attempt))
                continue
            raise ProviderError("Connection failed", provider=self.config.id)
    
    raise ProviderError("Max retries exceeded", provider=self.config.id)
```

### Cancellation Flow

```python
# In JobQueue:
def cancel(self, job_id: str) -> bool:
    job = self.store.get(job_id)
    if job is None:
        return False
    
    if job['status'] == 'running':
        job_type = job['type']
        entry = EXECUTORS.get(job_type, {})
        
        if entry.get('lock'):
            # Local job: interrupt via shared.state (existing)
            self._cancel_ids.add(job_id)
            from modules import shared
            shared.state.interrupt()
        else:
            # Cloud job: mark cancelled + fire-and-forget remote cancel
            self.store.update_status(job_id, 'cancelled', completed_at=JobStore.now())
            self._push_progress(job_id, {'type': 'status', 'status': 'cancelled'})
            self._attempt_remote_cancel(job_id, job)
        return True
    
    if job['status'] == 'pending':
        return self.store.cancel(job_id)
    return self.store.delete(job_id)

def _attempt_remote_cancel(self, job_id: str, job: dict) -> None:
    """Best-effort remote cancel. Fire and forget."""
    # Cloud executor stores remote_id in job metadata when available
    # This is a non-blocking attempt; failure is expected and acceptable
    pass
```

### Cloud Progress Event Shape

```python
# What the adapter pushes via on_progress callback:
{
    "type": "cloud_progress",
    "phase": "submitted",       # submitted | queued_remote | processing | downloading
    "detail": "Position 3 in queue",  # optional human-readable
    "progress": 0.0,           # 0-1 when known
    "elapsed": 4.2,            # seconds since submission
}
```

Frontend's `useJobTracker` already handles jobs with no preview frames. It maps `cloud_progress` events to the progress bar and phase label.

### Sequence Diagram

```text
User clicks Generate (cloud model selected)
    │
    ▼
Frontend POST /sdapi/v2/jobs {type: "cloud_image", provider: "openrouter", ...}
    │
    ▼
JobQueue.submit() → creates job in DB (status: pending)
    │
    ▼
_worker_loop picks up job → entry['lock'] is False
    │
    ▼
_cloud_pool.submit(_run_cloud_job)  ← non-blocking, worker loops immediately
    │
    ▼ (in cloud thread pool)
executor calls adapter.generate_image(params, on_progress)
    │
    ├── on_progress({phase: "submitted"})         → WS push to frontend
    │   adapter POSTs to provider API
    │
    ├── on_progress({phase: "processing", progress: 0.3})  → WS push
    │   adapter polls status / reads SSE
    │
    ├── on_progress({phase: "downloading", progress: 0.8}) → WS push
    │   adapter downloads result bytes
    │
    ▼
adapter returns ImageResult
    │
    ▼
executor saves images to output dir, returns result dict
    │
    ▼
_run_cloud_job marks job completed in DB, pushes {type: "completed"} via WS
```

## Planning Stages

All design decisions are resolved before implementation begins. Each stage is a focused brainstorming session that resolves one decision surface. Later stages depend on earlier ones.

**Design principle:** Utilise provider APIs to the maximum - grab model lists, capabilities, parameter schemas, and constraints live rather than maintaining hardcoded data. Cloud support should be first-class (matching local generation in UX, feature completeness, code quality, and maintainability).

### Stage 1 - Provider API Survey

Research the OpenAI-compatible API surface as implemented by key providers. Focus areas:

- `/v1/models` response shape (OpenRouter vs OpenAI vs generic) - what metadata is available live
- `/v1/images/generations` and `/v1/images/edits` - params, response format, provider differences
- `/v1/chat/completions` - streaming, tool use, vision (for captioning)
- Model ID conventions across providers
- Rate limiting, error responses, auth patterns
- What OpenRouter/NanoGPT/AIHubMix add beyond base OpenAI spec (pricing, routing, fallbacks)
- Gaps: what can't be done through OpenAI-compat (motivates future native adapters)

**Decides:** What live data is available, where providers diverge from spec, what the adapter must normalize.

**Providers to survey:**

- OpenRouter (richest metadata, reference for live data potential)
- OpenAI direct (spec author, reference implementation)
- NanoGPT / AIHubMix (privacy + Chinese model access, potential spec divergences)
- Generic self-hosted (vLLM, Ollama, text-generation-webui - minimal metadata)
- Fal (native API - full survey for future native adapter layer)
- Replicate (native API - full survey for future native adapter layer)

**Status:** Complete

### Stage 2 - Data Model & Capability Schema

Design the TypeScript/Python types that represent a cloud model and its capabilities. Define what `ItemModelV2` looks like when it serves both local and cloud models. Structure capabilities, parameter constraints, and provider metadata.

**Depends on:** Stage 1 (need to know what data providers actually return)

**Decides:** The contract between backend and frontend. Everything downstream consumes this shape.

**Status:** Complete - see "Stage 2 Schema" section

### Stage 3 - Provider Adapter Interface

Design the Python abstraction each provider implements. Method signatures, error contract, sync vs async, how live model/capability data flows through. How much normalization happens in the adapter vs. passed raw to the frontend.

**Depends on:** Stage 2 (adapter must produce the data model types)

**Decides:** The backend extensibility surface. Adding a new provider means implementing this interface.

**Status:** Complete - see "Stage 3 Design" section

### Stage 4 - Parameter Mapping Strategy

Define how Enso's generation params (prompt, steps, guidance, resolution, seed, etc.) translate to each provider. Identify universal params, params needing transformation, provider-only params, and how provider-specific params surface in the UI without hardcoding.

**Depends on:** Stages 1 + 3 (need real API param shapes and the adapter interface)

**Decides:** Whether the frontend needs per-provider UI branches or can stay generic.

**Status:** Complete - see "Stage 4 Design" section

### Stage 5 - Job Lifecycle & Execution

Design cloud job flow: submission, progress polling vs webhooks, cancellation semantics, timeout handling, error recovery, retry policy, concurrent job limits. How cloud jobs coexist with local jobs in the queue UI.

**Depends on:** Stage 3 (executor calls adapter methods)

**Decides:** The executor implementation shape and WebSocket message protocol.

**Status:** Complete - see "Stage 5 Design" section

### Stage 6 - Secret Management & Provider Configuration

Design key storage, validation, rotation. User onboarding flow (how they add a provider for the first time). Health checking (is this key valid? what's the balance?). Per-provider enable/disable.

**Depends on:** Stage 1 (need to know auth patterns per provider)

**Decides:** Settings UI scope and the security boundary.

**Status:** Complete - see "Stage 6 Design" section

### Stage 7 - Frontend Integration

Design model picker UX (how cloud models appear alongside local), parameter panel behavior when a cloud model is selected, progress display for remote jobs, result handling and metadata embedding.

**Depends on:** Stages 2 + 4 + 5 (needs data model, param mapping, and job lifecycle)

**Decides:** Component changes, new components, store modifications.

**Status:** Complete - see "Stage 7 Design" section

### Stage 8 - Mixed Workflows & Edge Cases

Design cloud-to-local chains (generate cloud -> upscale local), comparison mode (same prompt on cloud vs local), fallback behavior (cloud fails -> offer local), batch across providers. Canvas pipeline interactions (img2img, inpaint, ControlNet support per provider).

**Depends on:** Stages 5 + 7 (needs job lifecycle and frontend integration settled)

**Decides:** What's v1 scope vs. future, and any architectural changes needed to support chains cleanly.

**Status:** Complete - see "Stage 8 Design" section

## Resolved Questions

Questions from early brainstorming, now resolved by design stages:

- **Image gen endpoint routing** - Resolved by per-preset `image_via` field (Stage 3). Adapter abstracts it. Frontend doesn't know.
- **Capability descriptors** - Resolved: yes, two-level (modalities + capabilities) with progressive enrichment (Stage 2).
- **Provider-specific parameters** - Resolved: typed ParamDescriptors from provider metadata where available, null for unknown (Stage 2). Frontend gates visibility (Stage 4).
- **Model list caching** - Resolved: TTL-based in HttpTransport `get_cached()` method (Stage 3). Manual refresh via endpoint (Stage 6).
- **NanoGPT split-endpoint pattern** - Resolved: preset carries `model_list` array of endpoints to probe (Stage 3). NanoGPT preset lists all four.
- **Mixed workflows** - Resolved: existing "send to" pattern works as-is. Comparison mode and multi-provider batch deferred to v2 (Stage 8).

## Open Questions

### Model list filtering strategy

OpenRouter returns 200+ models across all modalities. Should the backend filter by modality before sending to frontend (smaller payload, multiple calls) or send everything and let the frontend filter (one call, larger payload)?

### Local model capability backfill

Stage 2 designed capabilities for cloud models. Should we backfill local models with capability data too (e.g. "this SD model supports inpainting natively")? Would require reading pipeline class from SD.Next model metadata. Deferred but architecturally ready.

### Cost estimation in UI

CloudModel carries pricing data. Should the frontend show estimated cost before generation? (e.g. "~$0.04 for 4 images at 1024x1024"). Requires multiplying pricing by params. UX design needed.

## Decisions Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-04-28 | Implement entirely in Enso, zero sdnext changes | Extension architecture already provides full job lifecycle ownership; no GPU contention means no need for queue_lock integration |
| 2026-04-28 | New executor rather than modifying existing `execute_generate` | Cloud dispatch is fundamentally different (HTTP API vs in-process function call); mixing them adds branches to every codepath |
| 2026-04-28 | OpenAI-compatible endpoints as primary integration layer | One adapter spec covers OpenRouter, NanoGPT, AIHubMix, custom URLs, and OpenAI direct. Fal/Replicate are future native-API additions for advanced features (ControlNet, latent streaming) |
| 2026-04-28 | Custom URL support is mandatory | Users need to point at self-hosted (vLLM, Ollama) or any compatible endpoint for privacy/autonomy. Provider = base_url + key + name, not a code-level concept |
| 2026-04-28 | Multi-modal from the start (at least in data model) | OpenAI-compat gives image + LLM + audio + video with same auth. Even if v1 only ships image + LLM, the types and adapter interface must not assume single-modality |
| 2026-04-28 | Live model discovery via /v1/models, no hardcoded lists | Minimises maintenance; what the provider offers is what Enso shows. Keeps model catalogs fresh without code changes |
| 2026-04-28 | All four modalities in v1: image, LLM, audio, video | Shared adapter makes marginal cost of each modality low. Data model and adapter interface designed for all four from the start |
| 2026-04-28 | Discriminated union for model types (LocalModel \| CloudModel) | Clean type narrowing, no phantom nulls. Each type has only the fields it uses. Frontend uses type guards |
| 2026-04-28 | Two-level capability system: modalities (broad) + capabilities (fine-grained) | Modalities enable broad filtering/routing (show me image gen models). Capabilities gate specific UI controls (disable ControlNet tab) |
| 2026-04-28 | Preset + custom provider configuration | Known providers (OpenRouter, OpenAI, NanoGPT, AIHubMix, Ollama) get declarative presets with endpoint routing rules. Custom providers probe. Explicit over implicit |
| 2026-04-28 | Structured pricing object (not raw passthrough) | Typed fields for each billing dimension. Enables cost estimation in UI. Null when provider doesn't expose pricing |
| 2026-04-28 | Typed ParamDescriptor array per model | Enables dynamic UI rendering of provider-specific params with correct control types and ranges. Null means unknown (show all, let API reject) |
| 2026-04-28 | Per-modality job request types (cloud_image, cloud_chat, cloud_tts, cloud_stt, cloud_video) | Matches existing pattern of separate job type interfaces. Type safety for which fields are valid per modality. extra_params escape hatch for provider-specific fields |
| 2026-04-28 | Protocol + Composition for adapter interface | Protocol defines contract (structural typing, future Fal/Replicate adapters just match the shape). HttpTransport injected for shared HTTP machinery. No inheritance hierarchy |
| 2026-04-28 | Executor declares lock requirement via EXECUTORS dict metadata | `{fn, lock: bool}` per entry. Cloud executors set lock=False, run concurrently. Minimal change to existing _execute_job |
| 2026-04-28 | Callback function for progress reporting | Adapter receives `on_progress(data)`, calls it with status updates. No coupling to job queue internals. Works for both streaming and one-shot |
| 2026-04-28 | Custom exception hierarchy for error contract | 6 exception classes covering real API failure modes (Auth, Quota, RateLimit, ContentFilter, ModelNotFound, ProviderError). Executor catches by type |
| 2026-04-28 | Async thread pool for cloud workers | Persistent event loop per cloud worker thread. Adapter methods are async def. True async with connection reuse, concurrent operations within a job |
| 2026-04-28 | Hybrid param mapping: frontend gates visibility, backend translates names | Frontend uses supported_params to show/hide controls (UX layer). Backend adapter maps Enso names to provider names (API layer). Clean separation, no silent dropping |
| 2026-04-28 | Local-only params hidden entirely for cloud models | Tabs that are fully local-only (Hires, Refiner, Detailer, Advanced, Color, Scripts) disappear when cloud model selected. No greying, no disabled state |
| 2026-04-28 | Per-preset param mapping overrides | Each preset carries its own param_maps dict. Base adapter has defaults, presets override where their provider diverges. Handles OpenRouter (chat for images) vs OpenAI (dedicated endpoint) cleanly |
| 2026-04-28 | Polling for progress, not webhooks | SD.Next runs on localhost behind NAT. Polling universally works. Webhooks future optimization only |
| 2026-04-28 | Best-effort non-blocking cancellation | Mark local job cancelled immediately. Fire-and-forget remote cancel. User sees instant response |
| 2026-04-28 | Per-modality timeouts with preset override | image 120s, chat 120s, TTS 30s, STT 60s, video 600s. Presets can override |
| 2026-04-28 | Retry transient errors only (max 3, exponential backoff) | 500/502/503 retried. 429 respects retry_after (max 1 retry). Auth/Quota/Content/NotFound fail immediately |
| 2026-04-28 | Thread pool of 8 workers for cloud jobs | I/O-bound, cheap to run concurrently. Rate limiting in HttpTransport, not concurrency limiting |
| 2026-04-28 | Existing JobStatus enum unchanged for cloud | Cloud phases (submitted/queued_remote/processing/downloading) in WS events, not DB. DB stays simple |
| 2026-04-28 | Worker loop dispatches cloud jobs to pool non-blocking | Local: inline serial with queue_lock. Cloud: submit to pool, immediately loop back for next job |
| 2026-04-28 | Plaintext JSON file for provider config + keys | `{enso_root}/cloud-providers.json`, gitignored. Same security model as SD.Next config.json. No encryption theatre |
| 2026-04-28 | Write-only API for keys, validate on add | POST sets key, GET never returns it. Immediate probe on add to confirm validity. Env vars override file |
| 2026-04-28 | New modelSelectionStore for unified model selection | Single source of truth for active model (local or cloud). UnifiedModel discriminated union. Local model loading as side effect. Syncs from SD.Next options on startup |
| 2026-04-28 | Cloud-to-local chains work already, no new architecture | Same "send to" pattern. Job results are local files regardless of source |
| 2026-04-28 | No automatic fallback on cloud failure | Show error with "Try local" button. User decides. Avoid unexpected model loads |
| 2026-04-28 | Always download result images locally | Provider URLs expire (OpenAI: 1h). Adapter saves bytes to output dir. JobResult never references remote URLs |
| 2026-04-28 | Comparison mode and multi-provider batch are v2 scope | Not architecturally blocked but need UX design. Deferred |
