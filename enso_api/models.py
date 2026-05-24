from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# --- Strict base for request bodies ---


class StrictBaseModel(BaseModel):
    """Base model that rejects unknown fields.

    Apply to request bodies so typos and stale fields produce a 422 with a
    field-level error instead of being silently dropped. Response models
    keep the default permissive behavior so adding new output fields stays
    a backwards-compatible change for clients.
    """

    model_config = ConfigDict(extra="forbid")


# --- Job request types live in enso_api/job_models.py and enso_api/cloud/models.py ---


# --- Job response types ---


class ImageRef(BaseModel):
    index: int
    url: str
    width: int
    height: int
    format: str
    size: int
    data: str | None = None
    """Base64-encoded image bytes; populated only when ``shared.opts.api_v2_base64`` is enabled."""


class JobResult(BaseModel):
    images: list[ImageRef] = Field(default_factory=list)
    processed: list[ImageRef] = Field(default_factory=list)
    info: dict = Field(default_factory=dict)
    params: dict = Field(default_factory=dict)


class JobResponse(BaseModel):
    id: str
    type: str
    status: str
    progress: float = 0
    step: int = 0
    steps: int = 0
    eta: float | None = None
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    error: str | None = None
    result: JobResult | None = None


class JobListResponse(BaseModel):
    items: list[JobResponse]
    total: int
    offset: int
    limit: int


class ErrorResponse(BaseModel):
    error: str
    code: int
    detail: str | None = None


# --- Simple response types for Swagger docs ---


class StatusResponse(BaseModel):
    id: str
    status: str


class MessageResponse(BaseModel):
    messages: list[str]


class ResPurgeV2(BaseModel):
    deleted: int


class ResJobStatsV2(BaseModel):
    total: int
    counts: dict[str, int]
    staging_bytes: int


class ReqBulkJobV2(BaseModel):
    action: str  # "cancel" or "delete"
    status: str | None = None
    type: str | None = None
    ids: list[str] | None = None
    before: str | None = None  # ISO timestamp (created_at < before)
    after: str | None = None  # ISO timestamp (created_at >= after)
    confirm: bool = False  # explicit opt-in for no-filter requests


class ResBulkJobV2(BaseModel):
    action: str
    affected: int


VideoMode = Literal["t2v", "i2v", "flf2v", "vace", "animate"]
"""Video pipeline mode. Mirrors the TS ``VideoMode`` literal in
``src/api/types/video.ts``."""


class VideoModelEnriched(BaseModel):
    """An entry of GET /sdapi/v2/video/engines/{engine}/models.

    All fields required: the route at ``routes.py`` always passes them
    with derived values, so making them required tells the codegen the
    truth and removes the consumer-side coercion in ``useVideo.ts``.
    """

    name: str
    repo: str
    url: str
    cached: bool
    loaded: bool
    mode: VideoMode


class VideoEngine(BaseModel):
    engine: str
    models: list[str]
    model_details: list[VideoModelEnriched] = Field(default_factory=list)


class VideoModel(BaseModel):
    name: str
    repo: str
    url: str


class ReqVideoLoadV2(StrictBaseModel):
    """Load a video model into the engine."""

    engine: str = Field(title="Engine", description="Video engine name (e.g. wan, hunyuan)")
    model: str = Field(title="Model", description="Model name within the engine")


class ReqFramePackLoadV2(StrictBaseModel):
    """Load a FramePack model variant."""

    variant: str = Field(default="bi-directional", title="Variant", description="FramePack variant (e.g. bi-directional)")
    attention: str = Field(default="Default", title="Attention", description="Attention implementation")


class ReqHuggingFaceSettingsV2(StrictBaseModel):
    """Set or clear the HuggingFace Hub access token."""

    token: str | None = Field(default=None, title="Token", description="HF token; pass empty string or null to clear")


class VideoLoadResponse(MessageResponse):
    engine: str
    model: str


class FramePackLoadResponse(MessageResponse):
    variant: str


# --- V2 API models ---


class ItemExtraNetworkV2(BaseModel):
    name: str = Field(title="Name", description="Network short name")
    type: str = Field(title="Type", description="Network type: lora, model, embedding, etc.")
    title: str | None = Field(default=None, title="Title", description="Display title")
    fullname: str | None = Field(default=None, title="Full name", description="Fully qualified name")
    filename: str | None = Field(default=None, title="Filename", description="Path to file")
    hash: str | None = Field(default=None, title="Hash", description="Short hash")
    preview: str | None = Field(default=None, title="Preview", description="Preview thumbnail URL")
    version: str | None = Field(default=None, title="Version", description="Base model version")
    tags: list[str] = Field(default_factory=list, title="Tags", description="Tag list")
    size: int | None = Field(default=None, title="Size", description="File size in bytes")
    mtime: str | None = Field(default=None, title="Modified", description="ISO 8601 modification time")


class ResExtraNetworksV2(BaseModel):
    items: list[ItemExtraNetworkV2] = Field(title="Items", description="List of extra network items")
    total: int = Field(title="Total", description="Total matching items before pagination")
    offset: int = Field(title="Offset", description="Number of items skipped")
    limit: int = Field(title="Limit", description="Maximum items returned per page")


class ItemModelV2(BaseModel):
    title: str = Field(title="Title")
    model_name: str = Field(title="Model Name")
    filename: str = Field(title="Filename")
    type: str = Field(title="Type")
    hash: str | None = Field(default=None, title="Hash")
    sha256: str | None = Field(default=None, title="SHA256")
    size: int | None = Field(default=None, title="Size", description="File size in bytes")
    mtime: str | None = Field(default=None, title="Modified", description="ISO 8601 modification time")
    version: str | None = Field(default=None, title="Version")
    subfolder: str | None = Field(default=None, title="Subfolder")


class ResModelsV2(BaseModel):
    items: list[ItemModelV2] = Field(title="Items")
    total: int = Field(title="Total")
    offset: int = Field(title="Offset")
    limit: int = Field(title="Limit")


class ItemSamplerV2(BaseModel):
    name: str = Field(title="Name")
    group: str = Field(title="Group", description="Standard, FlowMatch, or Res4Lyf")
    compatible: bool | None = Field(default=None, title="Compatible", description="null if no model loaded")
    options: dict = Field(title="Options")


class ItemHistoryV2(BaseModel):
    id: int | str | None = Field(default=None, title="ID")
    job: str = Field(title="Job")
    op: str = Field(title="Operation")
    timestamp: float | None = Field(default=None, title="Timestamp")
    duration: float | None = Field(default=None, title="Duration")
    outputs: list[str] = Field(default_factory=list, title="Outputs")


class ResHistoryV2(BaseModel):
    items: list[ItemHistoryV2] = Field(title="Items")
    total: int = Field(title="Total")
    offset: int = Field(title="Offset")
    limit: int = Field(title="Limit")


class ResCheckpointV2(BaseModel):
    loaded: bool = Field(title="Loaded")
    type: str | None = Field(default=None, title="Type")
    class_name: str | None = Field(default=None, title="Class Name")
    checkpoint: str | None = Field(default=None, title="Checkpoint")
    title: str | None = Field(default=None, title="Title")
    name: str | None = Field(default=None, title="Name")
    filename: str | None = Field(default=None, title="Filename")
    hash: str | None = Field(default=None, title="Hash")


class ReqSetCheckpointV2(BaseModel):
    sd_model_checkpoint: str = Field(title="Checkpoint")
    dtype: str | None = Field(default=None, title="Dtype")
    force: bool = Field(default=False, title="Force")


class ResSetCheckpointV2(BaseModel):
    ok: bool = Field(title="OK")
    checkpoint: ResCheckpointV2 | None = Field(default=None, title="Checkpoint")


class ItemVaeV2(BaseModel):
    name: str = Field(title="Name", description="VAE model display name")
    filename: str = Field(title="Filename", description="Path to the VAE file")


class ItemUpscalerV2(BaseModel):
    name: str = Field(title="Name", description="Upscaler display name")
    group: str = Field(title="Group", description="Upscaler family name")
    model_name: str | None = Field(default=None, title="Model Name", description="Underlying model name")
    model_path: str | None = Field(default=None, title="Path", description="Path to the model file")
    scale: float | None = Field(default=None, title="Scale", description="Default upscale factor")


class ItemEmbeddingV2(BaseModel):
    name: str = Field(title="Name", description="Embedding trigger word")
    filename: str | None = Field(default=None, title="Filename", description="Path to the embedding file")
    step: int | None = Field(default=None, title="Step", description="Training step count")
    shape: int | None = Field(default=None, title="Shape", description="Embedding vector dimension")
    vectors: int | None = Field(default=None, title="Vectors", description="Number of vectors")
    sd_checkpoint: str | None = Field(default=None, title="SD Checkpoint", description="Training checkpoint hash")
    sd_checkpoint_name: str | None = Field(default=None, title="SD Checkpoint Name", description="Training checkpoint name")


class ResEmbeddingsV2(BaseModel):
    loaded: list[ItemEmbeddingV2] = Field(default_factory=list, title="Loaded", description="Successfully loaded embeddings")
    skipped: list[ItemEmbeddingV2] = Field(default_factory=list, title="Skipped", description="Embeddings skipped due to incompatibility")


class ItemPromptStyleV2(BaseModel):
    name: str = Field(title="Name", description="Style name")
    prompt: str | None = Field(default=None, title="Prompt", description="Prompt template text")
    negative_prompt: str | None = Field(default=None, title="Negative Prompt", description="Negative prompt template text")
    extra: str | None = Field(default=None, title="Extra", description="Additional style data")
    description: str | None = Field(default=None, title="Description", description="Human-readable style description")
    wildcards: str | None = Field(default=None, title="Wildcards", description="Wildcard references used by this style")
    filename: str | None = Field(default=None, title="Filename", description="Path to the styles file")
    preview: str | None = Field(default=None, title="Preview", description="URL to the style preview image")
    mtime: str | None = Field(default=None, title="Modified", description="ISO 8601 modification time")


class ResRefreshNetworksV2(BaseModel):
    ok: bool = Field(title="OK", description="Whether the refresh completed successfully")
    total: int = Field(default=0, title="Total", description="Total extra-network items after refresh")


# --- Options / Settings models (v2) ---


class OptionUpdateItemV2(BaseModel):
    key: str = Field(title="Key", description="Option key name")
    changed: bool = Field(title="Changed", description="Whether the value actually changed")


class ResSetOptionsV2(BaseModel):
    ok: bool = Field(title="OK", description="Whether the update completed successfully")
    updated: list[OptionUpdateItemV2] = Field(default_factory=list, title="Updated", description="Per-key update results")


class OptionComponentArgsV2(BaseModel):
    minimum: float | None = Field(default=None, title="Minimum")
    maximum: float | None = Field(default=None, title="Maximum")
    step: float | None = Field(default=None, title="Step")
    choices: list[str] | None = Field(default=None, title="Choices")
    precision: int | None = Field(default=None, title="Precision")
    multiselect: bool | None = Field(default=None, title="Multiselect")


class ItemOptionInfoV2(BaseModel):
    label: str = Field(title="Label")
    section_id: str | None = Field(default=None, title="Section ID")
    section_title: str = Field(title="Section Title")
    visible: bool = Field(title="Visible")
    hidden: bool = Field(title="Hidden")
    type: str = Field(title="Type", description="boolean, number, string, or array")
    component: str = Field(title="Component", description="UI component type")
    component_args: OptionComponentArgsV2 = Field(default_factory=OptionComponentArgsV2, title="Component Args")
    default: Any | None = Field(default=None, title="Default")
    is_legacy: bool = Field(title="Is Legacy")
    is_secret: bool = Field(title="Is Secret")


class ItemSectionInfoV2(BaseModel):
    id: str = Field(title="ID")
    title: str = Field(title="Title")
    hidden: bool = Field(title="Hidden")


class ResOptionsInfoV2(BaseModel):
    options: dict[str, ItemOptionInfoV2] = Field(default_factory=dict, title="Options")
    sections: list[ItemSectionInfoV2] = Field(default_factory=list, title="Sections")


class ItemSecretStatusV2(BaseModel):
    configured: bool = Field(title="Configured")
    source: str = Field(title="Source", description="env, file, or none")
    masked: str = Field(title="Masked", description="Masked value preview")


# --- Control / Preprocessing models (v2) ---


class ItemPreprocessorV2(BaseModel):
    name: str = Field(title="Name", description="Preprocessor name")
    group: str = Field(default="Other", title="Group", description="Category group")
    params: dict = Field(default_factory=dict, title="Params", description="Configurable parameters with default values")


class ReqPreprocessV2(BaseModel):
    image: str = Field(title="Image", description="Base64 encoded image or upload ref")
    model: str = Field(title="Model", description="Preprocessor model name")
    params: dict = Field(default_factory=dict, title="Params", description="Preprocessor settings overrides")


class ResPreprocessV2(BaseModel):
    ok: bool = Field(title="OK", description="Whether preprocessing completed successfully")
    model: str = Field(default="", title="Model", description="Processor model actually used")
    image: str = Field(default="", title="Image", description="Processed image in base64 format")


class ItemScriptV2(BaseModel):
    name: str = Field(title="Name")
    is_alwayson: bool = Field(title="Is Always-on")
    contexts: list[str] = Field(default_factory=list, title="Contexts", description="txt2img, img2img, control")
    args: list = Field(default_factory=list, title="Arguments")


class ResScriptsV2(BaseModel):
    scripts: list[ItemScriptV2] = Field(title="Scripts")


# --- Server info models (v2) ---


class VersionInfoV2(BaseModel):
    app: str = ""
    updated: str = ""
    commit: str = ""
    branch: str = ""
    url: str = ""


class ServerCapabilities(BaseModel):
    txt2img: bool = True
    img2img: bool = True
    control: bool = True
    video: bool = True
    websocket: bool = True


class ServerModelInfo(BaseModel):
    name: str | None = None
    type: str | None = None
    supports_strength: bool = True


class ResServerInfoV2(BaseModel):
    version: VersionInfoV2
    backend: str
    platform: str
    api_version: str = "v2"
    capabilities: ServerCapabilities = Field(default_factory=ServerCapabilities)
    model: ServerModelInfo = Field(default_factory=ServerModelInfo)


# --- Memory models (v2) ---


class MemoryUsage(BaseModel):
    free: int | None = None
    used: int | None = None
    total: int | None = None


class MemoryPeakUsage(BaseModel):
    current: int | None = None
    peak: int | None = None


class MemoryWarnings(BaseModel):
    retries: int = 0
    oom: int = 0


class RamMemoryV2(BaseModel):
    free: int | None = None
    used: int | None = None
    total: int | None = None
    error: str | None = None


class CudaMemoryV2(BaseModel):
    system: MemoryUsage | None = None
    active: MemoryPeakUsage | None = None
    allocated: MemoryPeakUsage | None = None
    reserved: MemoryPeakUsage | None = None
    inactive: MemoryPeakUsage | None = None
    events: MemoryWarnings | None = None
    error: str | None = None


class ResMemoryV2(BaseModel):
    ram: RamMemoryV2
    cuda: CudaMemoryV2


# --- System info & GPU models (v2) ---


class ResSystemInfoV2(BaseModel):
    version: dict[str, str] = Field(default_factory=dict)
    uptime: str = ""
    timestamp: str = ""
    platform: dict[str, str] = Field(default_factory=dict)
    torch: str = ""
    gpu: dict[str, str] = Field(default_factory=dict)
    device: dict[str, str] = Field(default_factory=dict)
    libs: dict[str, str] = Field(default_factory=dict)
    backend: str = ""
    pipeline: str = ""
    cross_attention: str = ""
    flags: list[str] = Field(default_factory=list)


class GpuMetrics(BaseModel):
    load_gpu: float | None = None
    load_vram: float | None = None
    temperature: float | None = None
    fan_speed: float | None = None
    power_current: float | None = None
    power_limit: float | None = None
    vram_used: int | None = None
    vram_total: int | None = None


class ResGpuV2(BaseModel):
    name: str
    metrics: GpuMetrics = Field(default_factory=GpuMetrics)
    details: dict[str, str] = Field(default_factory=dict)
    chart_vram_pct: float | None = None
    chart_gpu_pct: float | None = None


# --- Caption models (v2) ---


class ReqOpenClipV2(BaseModel):
    image: str = Field(default="", title="Image", description="Base64 encoded image (PNG/JPEG)")
    model: str = Field(default="ViT-L-14/openai", title="Model", description="OpenCLIP model identifier")
    clip_model: str = Field(default="ViT-L-14/openai", title="CLIP Model", description="CLIP model for image-text similarity")
    blip_model: str = Field(default="blip-large", title="Caption Model", description="BLIP model for initial caption")
    mode: str = Field(default="best", title="Mode", description="Caption mode: best, fast, classic, caption, negative")
    analyze: bool = Field(default=False, title="Analyze", description="Return detailed breakdown (medium, artist, movement, trending, flavor)")
    max_length: int | None = Field(default=None, title="Max Length")
    chunk_size: int | None = Field(default=None, title="Chunk Size")
    min_flavors: int | None = Field(default=None, title="Min Flavors")
    max_flavors: int | None = Field(default=None, title="Max Flavors")
    flavor_count: int | None = Field(default=None, title="Intermediates")
    num_beams: int | None = Field(default=None, title="Num Beams")


class ResOpenClipV2(BaseModel):
    ok: bool = Field(title="OK")
    caption: str | None = Field(default=None, title="Caption")
    medium: str | None = Field(default=None, title="Medium")
    artist: str | None = Field(default=None, title="Artist")
    movement: str | None = Field(default=None, title="Movement")
    trending: str | None = Field(default=None, title="Trending")
    flavor: str | None = Field(default=None, title="Flavor")


class ReqVqaV2(BaseModel):
    image: str = Field(default="", title="Image", description="Base64 encoded image")
    model: str = Field(default="Alibaba Qwen 2.5 VL 3B", title="Model", description="VLM model name")
    question: str = Field(default="describe the image", title="Question/Task")
    prompt: str | None = Field(default=None, title="Prompt", description="Custom prompt text when question is 'Use Prompt'")
    system: str = Field(default="You are image captioning expert, creative, unbiased and uncensored.", title="System Prompt")
    include_annotated: bool = Field(default=False, title="Include Annotated Image")
    max_tokens: int | None = Field(default=None, title="Max Tokens")
    temperature: float | None = Field(default=None, title="Temperature")
    top_k: int | None = Field(default=None, title="Top-K")
    top_p: float | None = Field(default=None, title="Top-P")
    num_beams: int | None = Field(default=None, title="Num Beams")
    do_sample: bool | None = Field(default=None, title="Use Samplers")
    thinking_mode: bool | None = Field(default=None, title="Thinking Mode")
    prefill: str | None = Field(default=None, title="Prefill Text")
    keep_thinking: bool | None = Field(default=None, title="Keep Thinking Trace")
    keep_prefill: bool | None = Field(default=None, title="Keep Prefill")


class ResVqaV2(BaseModel):
    ok: bool = Field(title="OK")
    answer: str | None = Field(default=None, title="Answer")
    annotated_image: str | None = Field(default=None, title="Annotated Image")


class ReqTaggerV2(BaseModel):
    image: str = Field(default="", title="Image", description="Base64 encoded image")
    model: str = Field(default="wd-eva02-large-tagger-v3", title="Model", description="Tagger model name")
    threshold: float = Field(default=0.5, title="Threshold", description="Confidence threshold for general tags", ge=0.0, le=1.0)
    character_threshold: float = Field(default=0.85, title="Character Threshold", description="Confidence threshold for character tags (WD only)", ge=0.0, le=1.0)
    max_tags: int = Field(default=74, title="Max Tags", ge=1, le=512)
    include_rating: bool = Field(default=False, title="Include Rating")
    sort_alpha: bool = Field(default=False, title="Sort Alphabetically")
    use_spaces: bool = Field(default=False, title="Use Spaces")
    escape_brackets: bool = Field(default=True, title="Escape Brackets")
    exclude_tags: str = Field(default="", title="Exclude Tags")
    show_scores: bool = Field(default=False, title="Show Scores")


class ResTaggerV2(BaseModel):
    ok: bool = Field(title="OK")
    tags: str = Field(title="Tags")
    scores: dict | None = Field(default=None, title="Scores")


class ItemVlmModelV2(BaseModel):
    name: str = Field(title="Name")
    group: str = Field(title="Group", description="Architecture family")
    repo: str = Field(title="Repository")
    prompts: list[str] = Field(title="Prompts")
    capabilities: list[str] = Field(title="Capabilities")
    cached: bool = Field(title="Cached", description="Model is available in local HF cache")


class ItemTaggerModelV2(BaseModel):
    name: str = Field(title="Name")
    type: str = Field(title="Type")


# --- Log models (v2) ---


class ResLogV2(BaseModel):
    lines: list[str] = Field(title="Lines", description="Log lines from the in-memory buffer")
    total: int = Field(title="Total", description="Number of lines returned")


class ResLogClearV2(BaseModel):
    ok: bool = Field(title="OK")


# --- PNG Info models (v2) ---


class ReqPngInfoV2(BaseModel):
    image: str = Field(title="Image", description="Base64 encoded PNG image")


class ResPngInfoV2(BaseModel):
    ok: bool = Field(title="OK")
    info: str = Field(default="", title="Info", description="Raw generation parameters string")
    items: dict[str, Any] = Field(default_factory=dict, title="Items", description="All metadata fields from the image")
    parameters: dict[str, Any] = Field(default_factory=dict, title="Parameters", description="Parsed generation parameters")


# --- Extension models (v2) ---


class ItemExtensionV2(BaseModel):
    name: str = Field(title="Name")
    remote: str | None = Field(default=None, title="Remote")
    branch: str = Field(default="unknown", title="Branch")
    commit_hash: str | None = Field(default=None, title="Commit Hash")
    version: str | None = Field(default=None, title="Version")
    commit_date: str | None = Field(default=None, title="Commit Date")
    enabled: bool = Field(default=True, title="Enabled")


# --- Detailer models (v2) ---


class ItemDetailerV2(BaseModel):
    name: str = Field(title="Name")
    path: str | None = Field(default=None, title="Path")


# --- Job Type models (v2) ---


class ItemJobTypeV2(BaseModel):
    """One entry of GET /sdapi/v2/job-types: a job type accepted by POST /sdapi/v2/jobs."""

    type: str = Field(title="Type", description="Discriminator value used in the POST /sdapi/v2/jobs body")
    title: str = Field(title="Title", description="Human-friendly display name")
    description: str = Field(title="Description", description="What this job type does (cleaned class docstring)")
    category: Literal["core", "video", "model-management", "cloud"] = Field(title="Category", description="Logical grouping")
    runtime: Literal["local", "cloud"] = Field(title="Runtime", description="Where the job executes")
    interruptible: bool = Field(
        title="Interruptible",
        description=("True if DELETE /sdapi/v2/jobs/{id} can interrupt mid-run via shared.state.interrupt(). False for cloud jobs: DELETE marks the row cancelled but the in-flight HTTP call continues and its result is discarded."),
    )
    extends: str | None = Field(
        default=None,
        title="Extends",
        description="Discriminator value of a parent type whose schema is fully inherited (e.g. xyz-grid extends generate)",
    )
    schema_ref: str = Field(
        title="Schema Ref",
        description="JSON Pointer into /openapi.json #/components/schemas for the request body",
    )


# --- Prompt Enhance models (v2) ---


class ItemPromptEnhanceModelV2(BaseModel):
    name: str = Field(title="Name")
    group: str = Field(title="Group", description="Architecture family")
    vision: bool = Field(title="Vision", description="Supports image input")
    thinking: bool = Field(title="Thinking", description="Supports reasoning mode")
    cached: bool = Field(title="Cached", description="Model is available in local HF cache")


class ReqPromptEnhanceV2(BaseModel):
    prompt: str = Field(title="Prompt", description="Prompt to enhance")
    type: str = Field(title="Type", default="text", description="Type of enhancement: text, image, video")
    model: str | None = Field(title="Model", default=None)
    system_prompt: str | None = Field(title="System prompt", default=None)
    image: str | None = Field(title="Image", default=None, description="Base64 encoded image")
    seed: int = Field(title="Seed", default=-1)
    nsfw: bool = Field(title="NSFW", default=True)
    prefix: str | None = Field(title="Prefix", default=None)
    suffix: str | None = Field(title="Suffix", default=None)
    do_sample: bool | None = Field(title="Sample", default=None)
    max_tokens: int | None = Field(title="Max tokens", default=None)
    temperature: float | None = Field(title="Temperature", default=None)
    repetition_penalty: float | None = Field(title="Repetition penalty", default=None)
    top_k: int | None = Field(title="Top K", default=None)
    top_p: float | None = Field(title="Top P", default=None)
    thinking: bool = Field(title="Thinking", default=False)
    keep_thinking: bool = Field(title="Keep thinking", default=False)
    use_vision: bool = Field(title="Use vision", default=True)
    prefill: str | None = Field(title="Prefill", default=None)
    keep_prefill: bool = Field(title="Keep prefill", default=False)


class ResPromptEnhanceV2(BaseModel):
    ok: bool = Field(title="OK")
    prompt: str = Field(title="Prompt", description="Enhanced prompt")
    seed: int = Field(title="Seed", description="Seed used")


# --- Model operations request bodies (v2) ---


class ReqModelSaveV2(StrictBaseModel):
    """POST /sdapi/v2/model/save body."""

    name: str = Field(title="Name", description="Output model name")
    path: str | None = Field(default=None, title="Path", description="Output directory override")
    shard: str | None = Field(default=None, title="Shard", description="Shard size for large model splits")
    overwrite: bool = Field(default=False, title="Overwrite", description="Allow replacing an existing file")


class ReqHfDownloadV2(StrictBaseModel):
    """POST /sdapi/v2/model/hf/download body."""

    hub_id: str = Field(title="Hub ID", description="HuggingFace repo ID (e.g. stabilityai/stable-diffusion-xl-base-1.0)")
    token: str = Field(default="", title="Token", description="HF access token; blank uses the server-saved token")
    variant: str = Field(default="", title="Variant", description="Optional variant tag (e.g. fp16)")
    revision: str = Field(default="", title="Revision", description="Optional branch or commit SHA")
    mirror: str = Field(default="", title="Mirror", description="Optional mirror URL")
    custom_pipeline: str = Field(default="", title="Custom Pipeline", description="Optional custom pipeline name")


class ReqCivitaiDownloadV2(StrictBaseModel):
    """POST /sdapi/v2/model/civitai/download body."""

    url: str = Field(title="URL", description="CivitAI download URL")
    name: str = Field(default="", title="Name", description="Optional output filename")
    path: str = Field(default="", title="Path", description="Optional destination directory")
    model_type: str = Field(default="", title="Model Type", description="Type folder (e.g. Checkpoint, Lora)")
    token: str | None = Field(default=None, title="Token", description="Optional CivitAI API token")


class ReqMergeV2(StrictBaseModel):
    """POST /sdapi/v2/model/merge body."""

    custom_name: str = Field(title="Custom Name")
    primary_model_name: str = Field(title="Primary Model")
    secondary_model_name: str = Field(title="Secondary Model")
    merge_mode: str = Field(title="Merge Mode")
    tertiary_model_name: str | None = Field(default=None, title="Tertiary Model")
    alpha: float = Field(default=0.5, title="Alpha")
    beta: float = Field(default=0.5, title="Beta")
    alpha_preset: str | None = Field(default=None, title="Alpha Preset")
    alpha_preset_lambda: float | None = Field(default=None, title="Alpha Preset Lambda")
    alpha_base: str | None = Field(default=None, title="Alpha Base")
    alpha_in_blocks: str | None = Field(default=None, title="Alpha In Blocks")
    alpha_mid_block: str | None = Field(default=None, title="Alpha Mid Block")
    alpha_out_blocks: str | None = Field(default=None, title="Alpha Out Blocks")
    beta_preset: str | None = Field(default=None, title="Beta Preset")
    beta_preset_lambda: float | None = Field(default=None, title="Beta Preset Lambda")
    beta_base: str | None = Field(default=None, title="Beta Base")
    beta_in_blocks: str | None = Field(default=None, title="Beta In Blocks")
    beta_mid_block: str | None = Field(default=None, title="Beta Mid Block")
    beta_out_blocks: str | None = Field(default=None, title="Beta Out Blocks")
    precision: str = Field(default="fp16", title="Precision")
    checkpoint_format: str = Field(default="safetensors", title="Checkpoint Format")
    save_metadata: bool = Field(default=True, title="Save Metadata")
    weights_clip: bool = Field(default=False, title="Weights Clip")
    prune: bool = Field(default=False, title="Prune")
    re_basin: bool = Field(default=False, title="Re-Basin")
    re_basin_iterations: int = Field(default=0, title="Re-Basin Iterations")
    device: str = Field(default="cpu", title="Device")
    unload: bool = Field(default=True, title="Unload")
    overwrite: bool = Field(default=False, title="Overwrite")
    bake_in_vae: str | None = Field(default=None, title="Bake-in VAE")


class ReqReplaceV2(StrictBaseModel):
    """POST /sdapi/v2/model/replace body."""

    model_type: str = Field(title="Model Type")
    model_name: str = Field(title="Model Name")
    custom_name: str = Field(title="Custom Name")
    comp_unet: str = Field(default="", title="UNET Component")
    comp_vae: str = Field(default="", title="VAE Component")
    comp_te1: str = Field(default="", title="Text Encoder 1")
    comp_te2: str = Field(default="", title="Text Encoder 2")
    precision: str = Field(default="fp16", title="Precision")
    comp_scheduler: str = Field(default="", title="Scheduler")
    comp_prediction: str = Field(default="", title="Prediction Type")
    comp_lora: str = Field(default="", title="LoRA")
    comp_fuse: float = Field(default=0.0, title="LoRA Fuse Weight")
    meta_author: str = Field(default="", title="Author")
    meta_version: str = Field(default="", title="Version")
    meta_license: str = Field(default="", title="License")
    meta_desc: str = Field(default="", title="Description")
    meta_hint: str = Field(default="", title="Hint")
    create_diffusers: bool = Field(default=True, title="Create Diffusers")
    create_safetensors: bool = Field(default=False, title="Create Safetensors")
    debug: bool = Field(default=False, title="Debug")


class ReqLoaderComponentsV2(StrictBaseModel):
    """POST /sdapi/v2/model/loader/components body."""

    model_type: str = Field(title="Model Type", description="Pipeline class name, or 'Current'")


class LoaderComponentOverrideV2(StrictBaseModel):
    """One element of the components list in ReqLoaderLoadV2."""

    id: int = Field(title="ID")
    local: str | None = Field(default=None, title="Local Path")
    remote: str | None = Field(default=None, title="Remote URL")
    dtype: str | None = Field(default=None, title="Dtype")
    quant: bool | None = Field(default=None, title="Quant")


class ReqLoaderLoadV2(StrictBaseModel):
    """POST /sdapi/v2/model/loader/load body."""

    model_type: str = Field(title="Model Type")
    repo: str = Field(title="Repo", description="HuggingFace repo ID or local path")
    components: list[LoaderComponentOverrideV2] | None = Field(default=None, title="Components")


class ReqLoraExtractV2(StrictBaseModel):
    """POST /sdapi/v2/model/lora/extract body."""

    filename: str = Field(title="Filename")
    max_rank: int = Field(default=64, title="Max Rank")
    auto_rank: bool = Field(default=False, title="Auto Rank")
    rank_ratio: float = Field(default=0.5, title="Rank Ratio")
    modules: list[str] = Field(default_factory=lambda: ["te", "unet"], title="Modules")
    overwrite: bool = Field(default=False, title="Overwrite")
