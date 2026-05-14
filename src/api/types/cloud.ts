import type { SdModelV2 } from "./models";
import type { VideoMode } from "./video";

// --- Modality & Capability ---

export type Modality =
  | "text-to-image"
  | "image-to-image"
  | "inpaint"
  | "chat"
  | "vision"
  | "audio-in"
  | "audio-out"
  | "text-to-video"
  | "image-to-video";

export type Capability =
  | "streaming"
  | "tools"
  | "structured-output"
  | "controlnet"
  | "ip-adapter"
  | "lora"
  | "negative-prompt"
  | "seed"
  | "guidance"
  | "style"
  | "quality"
  | "reasoning";

// --- Model Types ---

export interface ModelPricing {
  prompt_token?: string;
  completion_token?: string;
  per_image?: string;
  per_second?: string;
  per_request?: string;
  cache_read_token?: string;
  cache_write_token?: string;
  currency: "USD";
}

export interface ParamDescriptor {
  name: string;
  type: "float" | "int" | "string" | "bool" | "enum";
  min?: number;
  max?: number;
  step?: number;
  default?: number | string | boolean;
  options?: string[];
}

export type ImageFormat = "png" | "jpeg" | "webp";
export type InputTransport = "multipart" | "base64";

export interface InputLimits {
  maxImageBytes: number;
  maxLongestSide: number | null;
  formats: ImageFormat[];
  transport: InputTransport;
}

export interface CloudModel {
  source: "cloud";
  id: string;
  name: string;
  provider: string;
  modalities: Modality[];
  capabilities: Capability[];
  pricing: ModelPricing | null;
  context_length: number | null;
  supported_params: ParamDescriptor[] | null;
  description: string | null;
  default_params: Record<string, unknown> | null;
}

export type LocalModel = SdModelV2 & { source: "local" };

/** Which VideoPanel form a local video model renders. Engine-specific
 * forms own different param surfaces (Wan/Hunyuan vs FramePack vs LTX),
 * so the discriminator travels on the model itself rather than being
 * recomputed at every render site. */
export type LocalVideoEngineKind = "generic" | "framepack" | "ltx";

/** A locally-served video model (Wan, Hunyuan, FramePack variant, LTX, etc.)
 * surfaced alongside local image checkpoints and cloud models in the unified
 * ModelSelector. The `engine` + `model` pair maps directly to the body of
 * /sdapi/v2/video/load (or /sdapi/v2/framepack/load when kind === "framepack",
 * where `model` is the variant name). `title` is a composed identity used as
 * a stable React/identity key. */
export interface LocalVideoModel {
  source: "local-video";
  engine: string;
  model: string;
  name: string;
  title: string;
  mode: VideoMode;
  cached: boolean;
  loaded: boolean;
  kind: LocalVideoEngineKind;
}

export type UnifiedModel = LocalModel | LocalVideoModel | CloudModel;

// --- Provider Types ---

export type ProviderPreset = "openrouter" | "openai" | "nanogpt" | "aihubmix" | "ollama" | "custom";

export interface ProviderConfig {
  id: string;
  name: string;
  preset: ProviderPreset;
  base_url: string;
  has_key: boolean;
  enabled: boolean;
}

// V1's ItemProvider shape (sdnext-owned). Aliased as Provider so existing
// frontend code reads naturally. Per-provider validation status is no longer
// server-tracked — call /sdapi/v1/cloud/providers/{id}/validate on demand.
export type Provider = ProviderConfig;

export interface ProviderWithModels extends Provider {
  models: CloudModel[];
}

// --- Cloud Job Request Types ---

export type CloudJobPhase = "submitted" | "queued_remote" | "processing" | "downloading";

export interface CloudImageJobParams {
  type: "cloud_image";
  provider: string;
  model: string;
  prompt: string;
  negative_prompt?: string;
  size?: string;
  n?: number;
  seed?: number;
  guidance?: number;
  steps?: number;
  quality?: string;
  style?: string;
  image?: string;
  mask?: string;
  strength?: number;
  extra_params?: Record<string, unknown>;
  priority?: number;
}

export interface CloudChatJobParams {
  type: "cloud_chat";
  provider: string;
  model: string;
  messages?: Array<{ role: string; content: string }>;
  prompt?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  seed?: number;
  extra_params?: Record<string, unknown>;
  priority?: number;
}

export interface CloudTtsJobParams {
  type: "cloud_tts";
  provider: string;
  model: string;
  input: string;
  voice?: string;
  speed?: number;
  response_format?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  priority?: number;
}

export interface CloudSttJobParams {
  type: "cloud_stt";
  provider: string;
  model: string;
  audio: string;
  language?: string;
  response_format?: "json" | "text" | "srt" | "vtt";
  priority?: number;
}

export interface CloudVideoJobParams {
  type: "cloud_video";
  provider: string;
  model: string;
  prompt: string;
  aspect_ratio?: string;
  duration?: number;
  size?: string;
  image?: string;
  extra_params?: Record<string, unknown>;
  priority?: number;
}

export type CloudJobRequest =
  | CloudImageJobParams
  | CloudChatJobParams
  | CloudTtsJobParams
  | CloudSttJobParams
  | CloudVideoJobParams;
