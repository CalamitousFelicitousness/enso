"""Strict Pydantic schema for POST /sdapi/v2/jobs.

This module owns the request bodies for every executor in
``enso_api.executors.EXECUTORS``. The :data:`JobRequest` discriminated
union is what ``submit_job`` accepts: any payload that does not match
one of the listed types, or that carries unknown fields, returns a 422
with a field-level error rather than being silently dropped.

The schema is organized as small mixins composed via multiple
inheritance into the leaf parameter classes. Each mixin maps to one
logical group of SD.Next pipeline parameters. Adding a new SD.Next
parameter means appending a single line to the appropriate mixin and
the matching TS field in ``src/api/types/generation.ts`` -- the two
sides are designed to be hand-maintained in lockstep.

Frontend reference: ``src/api/types/v2.ts``,
``src/api/types/generation.ts``, ``src/api/types/cloud.ts``.
Cloud-specific parameter classes live in ``enso_api/cloud/models.py``.
"""

from typing import Annotated, Any, Literal

from pydantic import ConfigDict, Field

from enso_api.cloud.models import (
    CloudChatParams,
    CloudImageParams,
    CloudSttParams,
    CloudTtsParams,
    CloudVideoParams,
)
from enso_api.models import StrictBaseModel

# --- Nested helper models ---------------------------------------------------


class ControlUnitParams(StrictBaseModel):
    """One ControlNet / T2I-Adapter / Reference / Style-Transfer / IP unit.

    Mirrors the per-unit dict consumed in
    ``enso_api.executors.execute_generate``.
    """

    unit_type: str = Field(default="controlnet", description="controlnet, t2i, reference, style_transfer, ip")
    model: str = Field(default="", description="Model identifier")
    process: str = Field(default="", description="Preprocessor identifier; 'None' to skip")
    strength: float = 1.0
    start: float = 0.0
    end: float = 1.0
    mode: str = Field(default="default", description="Pipeline mode override; 'default' to use unit's first choice")
    override: str | None = Field(default=None, description="Upload ref or base64 of an explicit processed image")
    image: str | None = Field(default=None, description="Upload ref or base64; alias of override")
    guess: bool = Field(default=False, description="ControlNet 'guess mode'")
    factor: float = Field(default=1.0, description="T2I-Adapter blend factor")
    attention: str = Field(default="Attention", description="Style-transfer attention type")
    fidelity: float = Field(default=0.5, description="Style-transfer fidelity")
    query_weight: float = Field(default=1.0, description="Style-transfer query weight")
    adain_weight: float = Field(default=1.0, description="Style-transfer adain weight")
    process_params: dict[str, Any] = Field(default_factory=dict, description="Preprocessor parameter overrides")


class IpAdapterUnitParams(StrictBaseModel):
    """One IP-Adapter reference set (style or subject)."""

    adapter: str = Field(default="", description="IP-Adapter model identifier")
    images: list[str] = Field(default_factory=list, description="Reference images (upload refs or base64)")
    masks: list[str] = Field(default_factory=list, description="Optional region masks aligned with images")
    scale: float = 1.0
    start: float = 0.0
    end: float = 1.0
    crop: bool = False


class XyzAxisInputParams(StrictBaseModel):
    """One axis specification for an XYZ grid job."""

    type: str = Field(description="Axis label, e.g. '[Param] Steps'")
    values: str = Field(description="Comma-separated values or range syntax (e.g. '10,15,20' or '10-30 (5)')")


# --- Mixins -----------------------------------------------------------------
#
# Every mixin inherits StrictBaseModel so unknown nested keys are also
# rejected when a leaf class composes the mixin. Field defaults are aligned
# with SD.Next's pipeline defaults where known; values not explicitly
# documented use safe no-op defaults (0, "", False).


class JobBase(StrictBaseModel):
    """Common header on every job submission."""

    priority: int = Field(default=0, description="Higher runs first; 0 is normal priority")
    live_previews: bool = Field(default=True, description="Stream live latent previews over WebSocket; set false to skip the per-step preview decode")


class GuidanceMixin(StrictBaseModel):
    """Classifier-free guidance, CFG end, image CFG, CLIP skip."""

    cfg_scale: float = 7.0
    cfg_end: float = 1.0
    diffusers_guidance_rescale: float = 0.0
    image_cfg_scale: float = 6.0
    clip_skip: int = 1


class PagMixin(StrictBaseModel):
    """Perturbed Attention Guidance."""

    pag_scale: float = 0.0
    pag_adaptive: float = 0.5


class SeedMixin(StrictBaseModel):
    """Seed and subseed."""

    seed: int = -1
    subseed: int = -1
    subseed_strength: float = 0.0
    sequential_seed: bool = False


class BatchMixin(StrictBaseModel):
    """Batch size and count."""

    batch_size: int = 1
    batch_count: int = 1


class HiresMixin(StrictBaseModel):
    """Hires-fix (latent upscale + second pass)."""

    enable_hr: bool = False
    hr_upscaler: str = "None"
    hr_scale: float = 2.0
    hr_second_pass_steps: int = 0
    hr_denoising_strength: float = 0.5
    hr_force: bool = False
    hr_resize_mode: int = 0
    hr_resize_x: int = 0
    hr_resize_y: int = 0
    hr_resize_context: str = ""


class UpscaleAfterMixin(StrictBaseModel):
    """Pure post-generation upscaler (no diffusion); runs after hires-fix."""

    resize_name_after: str = "None"
    scale_by_after: float = 1.0
    resize_mode_after: int = 0
    width_after: int = 0
    height_after: int = 0


class RefinerMixin(StrictBaseModel):
    """Two-stage refiner pass."""

    refiner_steps: int = 0
    refiner_start: float = 0.0
    refiner_prompt: str = ""
    refiner_negative: str = ""


class DetailerOverrides(StrictBaseModel):
    """Per-model or default detailer settings.

    All fields are optional. In a per-model entry, an unset field means
    "inherit from ``detailer_defaults``"; in ``detailer_defaults`` itself,
    an unset field means SD.Next's built-in default applies. The executor
    walks this dict and only sets ``p.detailer_*`` for fields that are
    not None, leaving the rest untouched.
    """

    strength: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        title="Strength",
        examples=[0.3],
        description="Denoise strength applied to each detected region. Lower = lighter touch, preserves more of the original.",
    )
    steps: int | None = Field(
        default=None,
        ge=0,
        le=99,
        title="Steps",
        examples=[10],
        description="Number of diffusion steps for the detailer pass on each detected region.",
    )
    resolution: int | None = Field(
        default=None,
        ge=256,
        le=4096,
        title="Resolution",
        examples=[1024],
        description="Working resolution for the detailer pass per region. Larger = more detail, slower.",
    )
    padding: int | None = Field(
        default=None,
        ge=0,
        le=256,
        title="Padding",
        examples=[20],
        description="Pixels of padding around each detected region before inpainting.",
    )
    blur: int | None = Field(
        default=None,
        ge=0,
        le=64,
        title="Blur",
        examples=[10],
        description="Mask edge blur. Softens the seam between inpainted region and surrounding image.",
    )
    conf: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        title="Confidence",
        examples=[0.6],
        description="Minimum detection confidence (0-1) for a region to be processed.",
    )
    iou: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        title="IoU",
        examples=[0.5],
        description="Intersection-over-union threshold for non-max suppression of overlapping detections.",
    )
    min_size: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        title="Min size",
        examples=[0.0],
        description="Minimum region size (fraction of image area) to detect.",
    )
    max_size: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        title="Max size",
        examples=[1.0],
        description="Maximum region size (fraction of image area) to detect.",
    )
    max: int | None = Field(
        default=None,
        ge=1,
        le=20,
        title="Max detect",
        examples=[2],
        description="Maximum number of detected regions to process per pass.",
    )
    sigma_adjust: float | None = Field(
        default=None,
        ge=0.0,
        le=2.0,
        title="Renoise",
        examples=[1.0],
        description="Sigma adjust at start. Multiplier on noise schedule for the detailer pass.",
    )
    sigma_adjust_max: float | None = Field(
        default=None,
        ge=0.0,
        le=2.0,
        title="Renoise end",
        examples=[1.0],
        description="Sigma adjust at end. Multiplier on noise schedule terminus for the detailer pass.",
    )
    segmentation: bool | None = Field(
        default=None,
        title="Segmentation",
        examples=[False],
        description="Use segmentation masks (if model supports them) instead of bounding boxes.",
    )
    include_detections: bool | None = Field(
        default=None,
        title="Include detections",
        examples=[False],
        description="Append the annotated detection-overlay image to the output set.",
    )
    merge: bool | None = Field(
        default=None,
        title="Merge",
        examples=[False],
        description="Merge multiple detections from this model before inpainting.",
    )
    sort: bool | None = Field(
        default=None,
        title="Sort",
        examples=[False],
        description="Sort detections by score before applying max-detect cap.",
    )
    prompt: str | None = Field(
        default=None,
        title="Prompt",
        examples=["highly detailed face"],
        description="Per-detector prompt override. Use [PROMPT] to inject the main prompt; leave empty to inherit.",
    )
    negative: str | None = Field(
        default=None,
        title="Negative",
        examples=["blurry, low quality"],
        description="Per-detector negative prompt override. Use [PROMPT] to inject the main negative; leave empty to inherit.",
    )
    classes: str | None = Field(
        default=None,
        title="Classes",
        examples=["person, face"],
        description="Comma-separated class filter for multi-class detector models. Empty = all classes.",
    )
    augment: bool | None = Field(
        default=None,
        title="Augment",
        examples=[False],
        description="Apply test-time augmentation during detection (slower, may catch more).",
    )


class DetailerModelEntry(DetailerOverrides):
    """A detailer model with optional per-model overrides.

    ``name`` is required and is the discriminator the executor uses to
    look up the loaded detector. Any other field, when set, overrides
    the matching value from ``detailer_defaults`` for this model only.
    """

    name: str = Field(
        title="Model name",
        examples=["face-yolo8n"],
        description="Detector model identifier. Must match a model loaded by SD.Next (see GET /sdapi/v2/detailers).",
    )


DetailerModelRef = str | DetailerModelEntry
"""A detailer model reference: bare string (= use defaults) or full entry."""


class DetailerMixin(StrictBaseModel):
    """Detailer / ADetailer parameters (V2 per-model override schema).

    Each entry in ``detailer_models`` is either a bare model-name string
    (= apply ``detailer_defaults`` straight) or a ``{name, ...overrides}``
    object that sets specific fields per model. ``detailer_defaults``
    holds the inherited base values. The executor loops ``detailer_models``
    and patches ``p.detailer_*`` per-iteration via a temporary
    ``modules.detailer.detail`` wrapper, so SD.Next's pipeline is
    unmodified and per-model overrides come for free.

    Shared between :class:`GenerateParams` (where the detailer runs as a
    post-pass) and :class:`DetailParams` (where it is the only pass).

    Example payload::

        {
            "detailer_enabled": true,
            "detailer_defaults": {"strength": 0.3, "steps": 10, "padding": 20},
            "detailer_models": [
                "face-yolo8n",
                {"name": "hand-yolo8n", "strength": 0.2, "padding": 32},
                {"name": "Anzhc Face seg 640 v4 y11n", "segmentation": true, "strength": 0.25}
            ]
        }

    The first entry uses the defaults verbatim; the second and third
    override only the named fields and inherit the rest. Replaces V1's
    fragile ``detailer_args`` colon-string format.
    """

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "detailer_enabled": True,
                    "detailer_defaults": {"strength": 0.3, "steps": 10, "padding": 20, "blur": 10},
                    "detailer_models": [
                        "face-yolo8n",
                        {"name": "hand-yolo8n", "strength": 0.2, "padding": 32},
                    ],
                },
            ],
        },
    )

    detailer_enabled: bool = Field(
        default=False,
        title="Detailer enabled",
        examples=[True],
        description="Master switch. When false, ``detailer_models`` is ignored and no detailer pass runs.",
    )
    detailer_defaults: DetailerOverrides = Field(
        default_factory=DetailerOverrides,
        title="Detailer defaults",
        description="Base values inherited by every model in ``detailer_models``. Per-model entries can override individual fields.",
    )
    detailer_models: list[DetailerModelRef] = Field(
        default_factory=list,
        title="Detailer models",
        description="Ordered list of detector models to run. Each entry is a bare model name (uses defaults) or {name, ...overrides} object.",
        examples=[
            [
                "face-yolo8n",
                {"name": "hand-yolo8n", "strength": 0.2, "padding": 32},
            ],
        ],
    )


class HdrMixin(StrictBaseModel):
    """Latent HDR / brightness / sharpening / tint corrections."""

    hdr_mode: int = 0
    hdr_brightness: float = 0.0
    hdr_sharpen: float = 0.0
    hdr_color: float = 0.0
    hdr_clamp: bool = False
    hdr_boundary: float = 4.0
    hdr_threshold: float = 0.95
    hdr_maximize: bool = False
    hdr_max_center: float = 0.6
    hdr_max_boundary: float = 1.0
    hdr_color_picker: str = "#000000"
    hdr_tint_ratio: float = 0.0
    hdr_apply_hires: bool = True


class GradingMixin(StrictBaseModel):
    """Color grading post-pass."""

    grading_brightness: float = 0.0
    grading_contrast: float = 0.0
    grading_saturation: float = 0.0
    grading_hue: float = 0.0
    grading_gamma: float = 1.0
    grading_sharpness: float = 0.0
    grading_color_temp: float = 6500.0
    grading_shadows: float = 0.0
    grading_midtones: float = 0.0
    grading_highlights: float = 0.0
    grading_clahe_clip: float = 0.0
    grading_clahe_grid: int = 8
    grading_shadows_tint: str = "#000000"
    grading_highlights_tint: str = "#ffffff"
    grading_split_tone_balance: float = 0.5
    grading_vignette: float = 0.0
    grading_grain: float = 0.0
    grading_lut_file: str = ""
    grading_lut_strength: float = 1.0


class ColorCorrectMixin(StrictBaseModel):
    """img2img color correction (histogram-based)."""

    img2img_color_correction: bool = False
    color_correction_method: str = "histogram"
    img2img_background_color: str = "#000000"
    img2img_fix_steps: bool = False


class SchedulersMixin(StrictBaseModel):
    """Sampler / scheduler tuning knobs."""

    schedulers_sigma: str = "default"
    schedulers_timestep_spacing: str = "default"
    schedulers_beta_schedule: str = "default"
    schedulers_prediction_type: str = "default"
    schedulers_shift: float = 3.0
    schedulers_base_shift: float = 0.5
    schedulers_max_shift: float = 1.15
    schedulers_sigma_adjust: float = 1.0
    schedulers_sigma_adjust_min: float = 0.2
    schedulers_sigma_adjust_max: float = 1.0
    schedulers_use_thresholding: bool = False
    schedulers_dynamic_shift: bool = False
    schedulers_rescale_betas: bool = False
    schedulers_use_loworder: bool = True
    schedulers_timesteps: str = ""


class FreeUMixin(StrictBaseModel):
    """FreeU UNet skip-connection rescaling."""

    freeu_enabled: bool = False
    freeu_b1: float = 1.2
    freeu_b2: float = 1.4
    freeu_s1: float = 0.9
    freeu_s2: float = 0.2


class HypertileMixin(StrictBaseModel):
    """HyperTile attention tiling for UNet and VAE."""

    hypertile_unet_enabled: bool = False
    hypertile_hires_only: bool = False
    hypertile_unet_tile: int = 0
    hypertile_unet_min_tile: int = 0
    hypertile_unet_swap_size: int = 1
    hypertile_unet_depth: int = 0
    hypertile_vae_enabled: bool = False
    hypertile_vae_tile: int = 128
    hypertile_vae_swap_size: int = 1


class TeaCacheMixin(StrictBaseModel):
    """TeaCache step skipping."""

    teacache_enabled: bool = False
    teacache_thresh: float = 0.15


class TokenMergeMixin(StrictBaseModel):
    """Token merging (ToMe) and token downsampling (ToDo)."""

    token_merging_method: str = "None"
    tome_ratio: float = 0.0
    todo_ratio: float = 0.0


class LoraMixin(StrictBaseModel):
    """LoRA / extra-network behavior toggles."""

    lora_fuse_native: bool = False
    lora_fuse_diffusers: bool = False
    lora_force_reload: bool = False
    extra_networks_default_multiplier: float = 1.0
    lora_apply_tags: int = 0


class AdvancedMixin(StrictBaseModel):
    """Advanced VAE / tiling / hidiffusion."""

    vae_type: str = "Full"
    tiling: bool = False
    hidiffusion: bool = False


class OutputSavingMixin(StrictBaseModel):
    """Per-stage save toggles forwarded to the backend pipeline."""

    save_images: bool = True
    samples_save: bool = True
    samples_format: str = "png"
    save_images_before_highres_fix: bool = False
    save_images_before_refiner: bool = False
    save_images_before_detailer: bool = False
    save_images_before_color_correction: bool = False
    grid_save: bool = False
    grid_format: str = "png"
    return_grid: bool = False
    save_mask: bool = False
    save_mask_composite: bool = False
    return_mask: bool = False
    return_mask_composite: bool = False
    keep_incomplete: bool = False
    image_metadata: bool = True
    jpeg_quality: int = 95
    send_images: bool = True


class Img2ImgMixin(StrictBaseModel):
    """Inputs, masks, init-image resize/inpaint controls.

    The frontend sends ``width_before`` / ``height_before`` (the requested
    generation size before any resize step). Bare ``width`` / ``height`` on
    :class:`GenerateParams` apply only to the first-stage canvas if the
    backend ever needs them; current FE flows always populate the
    ``_before`` variants.
    """

    inputs: list[str] = Field(default_factory=list, description="Init images (upload refs or base64). Empty for txt2img.")
    inits: list[str] = Field(default_factory=list, description="Pre-flattened init images for control-mode workflows")
    mask: str | None = Field(default=None, description="Inpaint mask (upload ref or base64); white = inpaint area")
    init_control: list[str] = Field(default_factory=list, description="Reference unit composited inputs")
    input_type: int = 0
    width_before: int = 512
    height_before: int = 512
    mask_blur: int = 0
    inpaint_full_res: bool = False
    inpaint_full_res_padding: int = 32
    inpainting_mask_invert: int = 0
    mask_apply_overlay: bool = True
    include_mask: bool = False
    inpainting_mask_weight: float = 1.0
    resize_mode_before: int = 0
    resize_name_before: str = "None"
    denoising_strength: float = 0.5


class ControlMixin(StrictBaseModel):
    """ControlNet / IP-Adapter unit lists with strict per-unit validation."""

    control: list[ControlUnitParams] = Field(default_factory=list)
    ip_adapter: list[IpAdapterUnitParams] = Field(default_factory=list)


class ScriptsMixin(StrictBaseModel):
    """Selected script and always-on script overrides."""

    script_name: str = ""
    script_args: list[Any] = Field(default_factory=list)
    alwayson_scripts: dict[str, Any] = Field(default_factory=dict)
    extra: dict[str, Any] = Field(default_factory=dict, description="Free-form pipeline overrides forwarded as control_set extras")


class OverrideSettingsMixin(StrictBaseModel):
    """Per-job ``shared.opts`` overrides applied for the run only."""

    override_settings: dict[str, Any] = Field(default_factory=dict)


# --- Leaf parameter classes -------------------------------------------------


class GenerateParams(
    Img2ImgMixin,
    HiresMixin,
    UpscaleAfterMixin,
    RefinerMixin,
    DetailerMixin,
    HdrMixin,
    GradingMixin,
    ColorCorrectMixin,
    SchedulersMixin,
    FreeUMixin,
    HypertileMixin,
    TeaCacheMixin,
    TokenMergeMixin,
    LoraMixin,
    PagMixin,
    GuidanceMixin,
    SeedMixin,
    BatchMixin,
    AdvancedMixin,
    ScriptsMixin,
    ControlMixin,
    OutputSavingMixin,
    OverrideSettingsMixin,
    JobBase,
):
    """Standard txt2img / img2img / control generation."""

    type: Literal["generate"] = "generate"
    prompt: str = ""
    negative_prompt: str = ""
    sampler_name: str = "Default"
    steps: int = 20
    width: int = 512
    height: int = 512


class UpscaleParams(JobBase):
    """Pure upscaling pass via ``modules.postprocessing.run_extras``."""

    type: Literal["upscale"] = "upscale"
    image: str = Field(description="Base64 encoded image or upload ref")
    upscaler: str = "None"
    scale: float = 2.0
    resize_mode: int = Field(default=0, description="0 = scale factor, 1 = explicit dimensions")
    width: int = Field(default=0, description="Target width when resize_mode=1")
    height: int = Field(default=0, description="Target height when resize_mode=1")
    crop: bool = Field(default=True, description="Crop to fit target dimensions")
    upscaler_2: str = Field(default="None", description="Second upscaler for blending")
    upscaler_2_visibility: float = Field(default=0.0, description="Blend ratio for second upscaler (0-1)")


class CaptionParams(JobBase):
    """Image captioning via VLM, OpenCLIP, or tagger backends."""

    type: Literal["caption"] = "caption"
    image: str = Field(description="Base64 encoded image or upload ref")
    backend: str = Field(default="vlm", description="vlm, openclip, or tagger")
    model: str | None = None
    prompt: str | None = Field(default=None, description="VLM-only: question or task prompt")


class EnhanceParams(JobBase):
    """Prompt enhancement via VLM or text LLM."""

    type: Literal["enhance"] = "enhance"
    prompt: str = ""
    model: str | None = None
    enhance_type: str = Field(default="text", description="text, image, or video")
    seed: int = -1
    image: str | None = None
    system_prompt: str = ""
    prefix: str = ""
    suffix: str = ""
    do_sample: bool = True
    max_tokens: int = 256
    temperature: float = 0.7
    repetition_penalty: float = 1.2
    top_k: int = 50
    top_p: float = 0.9
    thinking: bool = False
    keep_thinking: bool = False
    use_vision: bool = False
    prefill: str = ""
    keep_prefill: bool = False
    nsfw: bool = False


class DetectParams(JobBase):
    """YOLO detection over an input image."""

    type: Literal["detect"] = "detect"
    image: str = ""
    model: str | None = None


class PreprocessParams(JobBase):
    """Run a single ControlNet preprocessor over an image."""

    type: Literal["preprocess"] = "preprocess"
    image: str = ""
    model: str = ""
    params: dict[str, Any] = Field(default_factory=dict)


class DetailParams(DetailerMixin, OverrideSettingsMixin, JobBase):
    """Detailer-only pass (skip encode/base/hires).

    Equivalent to SD.Next's denoise=0 + detailer workflow: the input image
    passes through unchanged to the detailer, which detects regions and
    inpaints them. Use ``GenerateParams`` for full diffusion runs that
    happen to enable the detailer; this type exists to skip diffusion
    entirely.
    """

    type: Literal["detail"] = "detail"
    inputs: list[str] = Field(
        default_factory=list,
        description="Upload refs (upload:<id>) or base64-encoded input images. First entry is used.",
    )
    width: int = 512
    height: int = 512
    prompt: str = ""
    negative_prompt: str = ""
    seed: int = -1
    sampler_name: str = "Default"
    save_images: bool = True


class XyzGridParams(GenerateParams):
    """XYZ grid generation: sweep parameters across up to 3 axes.

    Inherits the full :class:`GenerateParams` schema so every generate
    field is valid here too -- the backend executor strips the
    xyz-specific keys below and recursively dispatches the remainder
    through ``execute_generate``.
    """

    type: Literal["xyz-grid"] = "xyz-grid"  # type: ignore[assignment]
    x_axis: XyzAxisInputParams | None = None
    y_axis: XyzAxisInputParams | None = None
    z_axis: XyzAxisInputParams | None = None
    draw_legend: bool = True
    include_grid: bool = True
    include_subgrids: bool = False
    include_images: bool = True
    include_time: bool = False
    include_text: bool = False
    margin_size: int = 0
    random_seeds: bool = False


# --- Video / motion job types ----------------------------------------------


class VideoParams(JobBase):
    """Native SD.Next video generation (Wan, HunyuanVideo, etc.)."""

    type: Literal["video"] = "video"
    engine: str
    model: str
    prompt: str
    negative: str = ""
    width: int = 848
    height: int = 480
    frames: int = 25
    steps: int = 30
    sampler: int = 0
    sampler_shift: float = -1.0
    dynamic_shift: bool = False
    seed: int = -1
    guidance_scale: float = 6.0
    guidance_true: float = -1.0
    init_image: str | None = None
    init_strength: float = 0.5
    last_image: str | None = None
    vae_type: str = "Default"
    vae_tile_frames: int = 0
    fps: int = 24
    interpolate: int = 0
    codec: str = "libx264"
    format: str = "mp4"
    codec_options: str = "crf:16"
    save_video: bool = True
    save_frames: bool = False
    save_safetensors: bool = False


class FramePackParams(JobBase):
    """FramePack video generation."""

    type: Literal["framepack"] = "framepack"
    prompt: str
    negative: str = ""
    seed: int = -1
    variant: str = "bi-directional"
    resolution: int = 640
    duration: int = 4
    latent_ws: int = 9
    steps: int = 25
    shift: float = 3.0
    cfg_scale: float = 1.0
    cfg_distilled: float = 10.0
    cfg_rescale: float = 0.0
    start_weight: float = 1.0
    end_weight: float = 1.0
    vision_weight: float = 1.0
    section_prompt: str = ""
    system_prompt: str = ""
    optimized_prompt: bool = True
    use_teacache: bool = True
    use_cfgzero: bool = False
    use_preview: bool = True
    attention: str = "Default"
    vae_type: str = "Full"
    init_image: str | None = None
    end_image: str | None = None
    fps: int = 30
    interpolate: int = 0
    codec: str = "libx264"
    format: str = "mp4"
    codec_options: str = "crf:16"
    save_video: bool = True
    save_frames: bool = False
    save_safetensors: bool = False
    vlm_enhance: bool = False
    vlm_model: str = ""
    vlm_system_prompt: str = ""
    styles: list[str] = Field(default_factory=list)


class LtxParams(JobBase):
    """LTX video generation."""

    type: Literal["ltx"] = "ltx"
    model: str
    prompt: str
    negative: str = ""
    seed: int = -1
    width: int = 768
    height: int = 512
    frames: int = 97
    steps: int = 50
    sampler: int = 0
    decode_timestep: float = 0.05
    image_cond_noise_scale: float = 0.025
    upsample_enable: bool = False
    upsample_ratio: float = 2.0
    refine_enable: bool = False
    refine_strength: float = 0.4
    condition_strength: float = 0.8
    condition_image: str | None = None
    condition_last: str | None = None
    condition_video_frames: int = 0
    condition_video_skip: int = 0
    audio_enable: bool = False
    fps: int = 24
    interpolate: int = 0
    codec: str = "libx264"
    format: str = "mp4"
    codec_options: str = "crf:16"
    save_video: bool = True
    save_frames: bool = False
    save_safetensors: bool = False
    styles: list[str] = Field(default_factory=list)


# --- Model management job types --------------------------------------------


class ModelLoadParams(JobBase):
    """Load or reload an SD checkpoint."""

    type: Literal["model-load"] = "model-load"
    sd_model_checkpoint: str | None = Field(default=None, description="Checkpoint name; supports 'name@url' for CivitAI")
    force: bool = Field(default=False, description="Unload current model first")
    dtype: str | None = Field(default=None, description="Override CUDA dtype")


class ModelMergeParams(JobBase):
    """Merge two or three checkpoints into a new model.

    Mirrors ``modules.extras.run_modelmerger``; arbitrary key-value pairs
    are forwarded after filtering out None / empty / zero values, so any
    keyword argument that ``run_modelmerger`` accepts is valid here.
    """

    type: Literal["model-merge"] = "model-merge"
    custom_name: str = Field(description="Output model name")
    primary_model_name: str = Field(description="Primary model")
    secondary_model_name: str = Field(description="Secondary model")
    tertiary_model_name: str | None = None
    interp_method: str | None = None
    multiplier: float | None = None
    save_as_half: bool | None = None
    save_as_safetensors: bool | None = None
    discard_weights: str | None = None
    metadata_settings: dict[str, Any] | None = None
    bake_in_vae: str | None = None
    config_source: int | None = None


class ModelReplaceParams(JobBase):
    """Replace components of a loaded model and save as a new model."""

    type: Literal["model-replace"] = "model-replace"
    model_type: str = ""
    model_name: str = ""
    custom_name: str = ""
    comp_unet: str = ""
    comp_vae: str = ""
    comp_te1: str = ""
    comp_te2: str = ""
    precision: str = "fp16"
    comp_scheduler: str = ""
    comp_prediction: str = ""
    comp_lora: str = ""
    comp_fuse: float = 0.0
    meta_author: str = ""
    meta_version: str = ""
    meta_license: str = ""
    meta_desc: str = ""
    meta_hint: str = ""
    create_diffusers: bool = True
    create_safetensors: bool = False
    debug: bool = False


class ModelSaveParams(JobBase):
    """Save the currently loaded model to disk."""

    type: Literal["model-save"] = "model-save"
    name: str = Field(description="Output model name")
    path: str | None = None
    shard: str | None = None
    overwrite: bool = False


class LoaderLoadParams(JobBase):
    """Load a model with custom component configuration."""

    type: Literal["loader-load"] = "loader-load"
    model_type: str = Field(description="Pipeline model type")
    repo: str = Field(description="HF repo ID or local path")
    components: dict[str, Any] | None = None


class LoraExtractParams(JobBase):
    """Extract a LoRA adapter from the currently loaded model."""

    type: Literal["lora-extract"] = "lora-extract"
    filename: str = Field(description="Output LoRA filename")
    max_rank: int = 64
    auto_rank: bool = False
    rank_ratio: float = 0.5
    modules: list[str] = Field(default_factory=lambda: ["te", "unet"])
    overwrite: bool = False


class HfDownloadParams(JobBase):
    """Download a model from the Hugging Face Hub."""

    type: Literal["hf-download"] = "hf-download"
    hub_id: str = Field(description="HuggingFace repo ID")
    token: str = ""
    variant: str = ""
    revision: str = ""
    mirror: str = ""
    custom_pipeline: str = ""


class RembgParams(JobBase):
    """Background removal."""

    type: Literal["rembg"] = "rembg"
    image: str = Field(description="Base64 encoded image or upload ref")
    model: str = "ben2"
    return_mask: bool = False
    refine: bool = False
    alpha_matting: bool = False
    alpha_matting_foreground_threshold: int = 240
    alpha_matting_background_threshold: int = 10
    alpha_matting_erode_size: int = 10


# --- The discriminated union -----------------------------------------------


JobRequest = Annotated[
    GenerateParams
    | UpscaleParams
    | CaptionParams
    | EnhanceParams
    | DetectParams
    | PreprocessParams
    | DetailParams
    | XyzGridParams
    | VideoParams
    | FramePackParams
    | LtxParams
    | ModelLoadParams
    | ModelMergeParams
    | ModelReplaceParams
    | ModelSaveParams
    | LoaderLoadParams
    | LoraExtractParams
    | HfDownloadParams
    | RembgParams
    | CloudImageParams
    | CloudChatParams
    | CloudTtsParams
    | CloudSttParams
    | CloudVideoParams,
    Field(discriminator="type"),
]
