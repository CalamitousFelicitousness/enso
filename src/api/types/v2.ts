// --- Job request types (discriminated union) ---

import type { ControlRequest } from "./generation";
import type {
  CloudImageJobParams,
  CloudChatJobParams,
  CloudTtsJobParams,
  CloudSttJobParams,
  CloudVideoJobParams,
  CloudJobPhase,
} from "./cloud";

export type GenerateJobRequest = ControlRequest & { type: "generate"; priority?: number };

export interface UpscaleJobParams {
  type: "upscale";
  image: string;
  upscaler?: string | undefined;
  scale?: number | undefined;
  priority?: number | undefined;
}

export interface CaptionJobParams {
  type: "caption";
  image: string;
  backend?: "vlm" | "openclip" | "tagger" | undefined;
  model?: string | undefined;
  priority?: number | undefined;
}

export interface EnhanceJobParams {
  type: "enhance";
  prompt?: string | undefined;
  model?: string | undefined;
  enhance_type?: "text" | "image" | "video" | undefined;
  seed?: number | undefined;
  image?: string | undefined;
  system_prompt?: string | undefined;
  prefix?: string | undefined;
  suffix?: string | undefined;
  priority?: number | undefined;
}

export interface DetectJobParams {
  type: "detect";
  image: string;
  model?: string | undefined;
  priority?: number | undefined;
}

/** One picture to process; the key names its map in the maps event and the
 * result. Mirrors PreprocessItem in enso_api/job_models.py. */
export interface PreprocessItem {
  image: string;
  process: string;
  params?: Record<string, unknown> | undefined;
  key: string;
}

export interface PreprocessJobParams {
  type: "preprocess";
  items: PreprocessItem[];
  priority?: number | undefined;
}

/** Per-model or default detailer overrides. Mirrors DetailerOverrides
 * in enso_api/job_models.py. All fields optional; unset = inherit. */
export interface DetailerOverrides {
  strength?: number | undefined;
  steps?: number | undefined;
  resolution?: number | undefined;
  padding?: number | undefined;
  blur?: number | undefined;
  conf?: number | undefined;
  iou?: number | undefined;
  min_size?: number | undefined;
  max_size?: number | undefined;
  max?: number | undefined;
  sigma_adjust?: number | undefined;
  sigma_adjust_max?: number | undefined;
  segmentation?: boolean | undefined;
  include_detections?: boolean | undefined;
  merge?: boolean | undefined;
  sort?: boolean | undefined;
  prompt?: string | undefined;
  negative?: string | undefined;
  classes?: string | undefined;
  augment?: boolean | undefined;
}

/** A detailer model with optional per-model overrides. */
export interface DetailerModelEntry extends DetailerOverrides {
  name: string;
}

/** Detailer model reference: bare string (= use defaults) or full entry. */
export type DetailerModelRef = string | DetailerModelEntry;

export interface DetailJobParams {
  type: "detail";
  inputs: string[];
  width: number;
  height: number;
  prompt?: string | undefined;
  negative_prompt?: string | undefined;
  seed?: number | undefined;
  sampler_name?: string | undefined;
  detailer_enabled?: boolean | undefined;
  detailer_defaults?: DetailerOverrides | undefined;
  detailer_models?: DetailerModelRef[] | undefined;
  save_images?: boolean | undefined;
  override_settings?: Record<string, unknown> | undefined;
  priority?: number | undefined;
}

export interface VideoGenerateParams {
  type: "video";
  engine: string;
  model: string;
  prompt: string;
  negative?: string;
  width?: number;
  height?: number;
  frames?: number;
  steps?: number;
  sampler?: number;
  sampler_shift?: number;
  dynamic_shift?: boolean;
  seed?: number;
  guidance_scale?: number;
  guidance_true?: number;
  init_image?: string | null;
  init_strength?: number;
  last_image?: string | null;
  vae_type?: string;
  vae_tile_frames?: number;
  fps?: number;
  interpolate?: number;
  codec?: string;
  format?: string;
  codec_options?: string;
  save_video?: boolean;
  save_frames?: boolean;
  save_safetensors?: boolean;
  priority?: number;
}

export interface FramePackJobParams {
  type: "framepack";
  prompt: string;
  negative?: string;
  seed?: number;
  variant?: string;
  resolution?: number;
  duration?: number;
  latent_ws?: number;
  steps?: number;
  shift?: number;
  cfg_scale?: number;
  cfg_distilled?: number;
  cfg_rescale?: number;
  start_weight?: number;
  end_weight?: number;
  vision_weight?: number;
  section_prompt?: string;
  system_prompt?: string;
  use_teacache?: boolean;
  optimized_prompt?: boolean;
  use_cfgzero?: boolean;
  use_preview?: boolean;
  attention?: string;
  vae_type?: string;
  init_image?: string | null;
  end_image?: string | null;
  fps?: number;
  interpolate?: number;
  codec?: string;
  format?: string;
  codec_options?: string;
  save_video?: boolean;
  save_frames?: boolean;
  save_safetensors?: boolean;
  priority?: number;
}

export interface LtxJobParams {
  type: "ltx";
  model: string;
  prompt: string;
  negative?: string;
  seed?: number;
  width?: number;
  height?: number;
  frames?: number;
  steps?: number;
  decode_timestep?: number;
  image_cond_noise_scale?: number;
  upsample_enable?: boolean;
  upsample_ratio?: number;
  refine_enable?: boolean;
  refine_strength?: number;
  condition_strength?: number;
  condition_image?: string | null;
  condition_last?: string | null;
  audio_enable?: boolean;
  fps?: number;
  interpolate?: number;
  codec?: string;
  format?: string;
  codec_options?: string;
  save_video?: boolean;
  save_frames?: boolean;
  save_safetensors?: boolean;
  priority?: number;
}

export interface XyzAxisInput {
  type: string;
  values: string;
}

export interface XyzGridJobParams {
  type: "xyz-grid";
  prompt?: string | undefined;
  negative_prompt?: string | undefined;
  steps?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  cfg_scale?: number | undefined;
  seed?: number | undefined;
  batch_size?: number | undefined;
  sampler_name?: string | undefined;
  denoising_strength?: number | undefined;
  inputs?: string[] | undefined;
  inits?: string[] | undefined;
  mask?: string | undefined;
  control?: Record<string, unknown>[] | undefined;
  ip_adapter?: Record<string, unknown>[] | undefined;
  save_images?: boolean | undefined;
  clip_skip?: number | undefined;
  cfg_stop?: number | undefined;
  x_axis?: XyzAxisInput | null | undefined;
  y_axis?: XyzAxisInput | null | undefined;
  z_axis?: XyzAxisInput | null | undefined;
  draw_legend?: boolean | undefined;
  include_grid?: boolean | undefined;
  include_subgrids?: boolean | undefined;
  include_images?: boolean | undefined;
  include_time?: boolean | undefined;
  include_text?: boolean | undefined;
  margin_size?: number | undefined;
  random_seeds?: boolean | undefined;
  priority?: number | undefined;
}

export interface RembgJobParams {
  type: "rembg";
  image: string;
  model?: string | undefined;
  return_mask?: boolean | undefined;
  refine?: boolean | undefined;
  alpha_matting?: boolean | undefined;
  alpha_matting_foreground_threshold?: number | undefined;
  alpha_matting_background_threshold?: number | undefined;
  alpha_matting_erode_size?: number | undefined;
  priority?: number | undefined;
}

/** Mirrors ProcessUpscaleParams in enso_api/job_models.py; field names are
 * the sdnext script's control names. */
export interface ProcessUpscaleParams {
  upscale_mode: number;
  upscale_by: number;
  upscale_to_width: number;
  upscale_to_height: number;
  upscale_crop: boolean;
  upscaler_1_name: string;
  upscaler_2_name: string;
  upscaler_2_visibility: number;
}

export interface ProcessDetailerParams {
  defaults: DetailerOverrides;
  models: DetailerModelRef[];
  sampler: string;
  prediction: string;
  shift: number;
  cfg_scale: number;
  options: string[];
  seed: number;
}

export interface ProcessGradingParams {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  gamma: number;
  sharpness: number;
  color_temp: number;
  shadows: number;
  midtones: number;
  highlights: number;
  clahe_clip: number;
  clahe_grid: number;
  shadows_tint: string;
  highlights_tint: string;
  split_tone_balance: number;
  vignette: number;
  grain: number;
  lut_cube_file: string;
  lut_strength: number;
}

export interface ProcessRembgParams {
  model: string;
  merge_alpha: boolean;
  refine: boolean;
  mask_only: boolean;
  postprocess_mask: boolean;
  alpha_matting: boolean;
  alpha_matting_foreground_threshold: number;
  alpha_matting_background_threshold: number;
  alpha_matting_erode_size: number;
}

export interface ProcessNudenetParams {
  enabled: boolean;
  lang: boolean;
  policy: boolean;
  banned: boolean;
  metadata: boolean;
  save_copy: boolean;
  score: number;
  blocks: number;
  censor: string[];
  method: string;
  overlay: string;
  allowed: string;
  alphabet: string;
  words: string;
  policy_model: string;
  policy_text: string;
}

export interface ProcessSeedvrParams {
  seedvr_enabled: boolean;
  seedvr_selected: string;
  seedvr_scale: number;
  seedvr_seed: number;
  seedvr_steps: number;
  seedvr_cfg_scale: number;
  seedvr_cfg_rescale: number;
  seedvr_tile_size: number;
  seedvr_tile_overlap: number;
  seedvr_batch_size: number;
  seedvr_batch_overlap: number;
  seedvr_offload: boolean;
  seedvr_interpolate: number;
  seedvr_codec: string;
  seedvr_codec_opt: string;
  seedvr_vae_memory: number;
  seedvr_vae_tile_encode: boolean;
  seedvr_vae_tile_decode: boolean;
}

export interface ProcessPixelartParams {
  pixelart_enabled: boolean;
  pixelart_block_size: number;
  pixelart_edge_block_size: number;
  pixelart_use_edge_detection: boolean;
  pixelart_image_weight: number;
  pixelart_sharpen_amount: number;
}

export interface ProcessDlssParams {
  dlss_enabled: string[];
  dlss_graph: boolean;
  dlss_chunk: number;
  dlss_full: boolean;
  nr_profile: string;
  nr_motion: string;
  nr_scale: number;
  nr_intensity: number;
  nr_blend: number;
  nr_detail: number;
  nr_colour: number;
  nr_radius: number;
  nr_threshold: number;
  nr_normalized: number;
  nr_local_tone: number;
  nr_local_structure: number;
  nr_skin_structure: number;
  nr_mask_structure: number;
  ss_profile: string;
  ss_scale: number;
  ss_detail: number;
  ss_colour: number;
  ss_radius: number;
  ss_threshold: number;
  fg_profile: string;
  fg_mode: string;
  fg_factor: number;
  fg_threshold: number;
}

export interface ProcessCreateVideoParams {
  filename: string;
  video_type: string;
  duration: number;
  loop: boolean;
  pad: number;
  interpolate: number;
  scale: number;
  change: number;
}

export type ProcessMode = "image" | "batch" | "folder" | "video";

/** Mirrors ProcessParams in enso_api/job_models.py. A section left out
 * leaves that script disabled on the server. */
export interface ProcessJobParams {
  type: "process";
  mode: ProcessMode;
  images?: string[] | undefined;
  video?: string | undefined;
  input_dir?: string | undefined;
  output_dir?: string | undefined;
  show_results?: boolean | undefined;
  save_output?: boolean | undefined;
  upscale?: ProcessUpscaleParams | undefined;
  detailer?: ProcessDetailerParams | undefined;
  grading?: ProcessGradingParams | undefined;
  rembg?: ProcessRembgParams | undefined;
  nudenet?: ProcessNudenetParams | undefined;
  seedvr?: ProcessSeedvrParams | undefined;
  pixelart?: ProcessPixelartParams | undefined;
  dlss?: ProcessDlssParams | undefined;
  create_video?: ProcessCreateVideoParams | undefined;
  priority?: number | undefined;
}

export interface MetadataSweepJobParams {
  type: "metadata-sweep";
  mode?: "scan" | "update" | undefined;
  priority?: number | undefined;
}

export type JobRequest =
  | GenerateJobRequest
  | UpscaleJobParams
  | RembgJobParams
  | ProcessJobParams
  | MetadataSweepJobParams
  | CaptionJobParams
  | EnhanceJobParams
  | DetectJobParams
  | PreprocessJobParams
  | DetailJobParams
  | VideoGenerateParams
  | FramePackJobParams
  | LtxJobParams
  | XyzGridJobParams
  | CloudImageJobParams
  | CloudChatJobParams
  | CloudTtsJobParams
  | CloudSttJobParams
  | CloudVideoJobParams;

// --- Job-type discovery ---

export type JobTypeCategory = "core" | "video" | "model-management" | "cloud";
export type JobTypeRuntime = "local" | "cloud";

/** One entry of GET /sdapi/v2/job-types. Mirrors ItemJobTypeV2 in
 * enso_api/models.py. */
export interface JobTypeV2 {
  type: string;
  title: string;
  description: string;
  category: JobTypeCategory;
  runtime: JobTypeRuntime;
  /** True if DELETE /sdapi/v2/jobs/{id} can interrupt mid-run. False for
   * cloud: DELETE marks the row cancelled but the in-flight HTTP call
   * continues and its result is discarded. */
  interruptible: boolean;
  /** Discriminator value of a parent type whose schema is fully inherited
   * (only "generate" for "xyz-grid" today). */
  extends: string | null;
  /** JSON Pointer into /openapi.json #/components/schemas for the request body. */
  schema_ref: string;
}

// --- Job response types ---

/** One generated image. `url` is a durable output address
 * (`/sdapi/v2/outputs/{id}`) that resolves for as long as the file exists,
 * independent of the job row's lifetime - except staged `save_images=false`
 * results, which carry a job-scoped URL matching their deliberately short
 * life. Mirrors ImageRef in enso_api/models.py. */
export interface ImageRef {
  index: number;
  url: string;
  width: number;
  height: number;
  format: string;
  size: number;
}

/** A cloud-generated video plus its sibling thumbnail. `thumbnail_url`
 * is null when extraction failed upstream; the mp4 itself is always
 * present at `url` when the ref exists. Both are durable output addresses,
 * as on ImageRef. Mirrors VideoRef in enso_api/models.py. */
export interface VideoRef {
  index: number;
  url: string;
  thumbnail_url: string | null;
  width: number;
  height: number;
  format: string;
  size: number;
  duration: number | null;
}

/** One line sdnext logged at warning level or above while the job ran.
 * Mirrors JobWarning in enso_api/models.py. */
export interface JobWarning {
  level: "warning" | "error";
  message: string;
}

export interface JobResult {
  images: ImageRef[];
  processed: ImageRef[];
  /** Every video executor reports here, local and cloud alike, and leaves
   * `images` empty. A still result is its own thumbnail. */
  videos?: VideoRef[] | undefined;
  info: Record<string, unknown>;
  params: Record<string, unknown>;
  /** Empty or absent when the job logged none. */
  warnings?: JobWarning[] | undefined;
  /** The maps the job made before generating, by client key, as upload
   * urls pinned while the job ran. Absent on results of older servers. */
  maps?: Record<string, string> | undefined;
}

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  progress: number;
  step: number;
  steps: number;
  eta: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  result: JobResult | null;
}

export interface JobListResponse {
  items: Job[];
  total: number;
  offset: number;
  limit: number;
}

export interface PurgeResponse {
  deleted: number;
}

export interface JobStats {
  total: number;
  counts: Partial<Record<JobStatus, number>>;
  staging_bytes: number;
  /** Rows in the durable outputs table. */
  outputs_total: number;
  /** Refs that kept a job-scoped URL because registration failed, since boot. */
  output_register_failures: number;
}

// --- Bulk job types ---

export interface BulkJobRequest {
  action: "cancel" | "delete";
  status?: string | undefined;
  type?: string | undefined;
  ids?: string[] | undefined;
  /** ISO timestamp; backend filters `created_at < before`. */
  before?: string | undefined;
  /** ISO timestamp; backend filters `created_at >= after`. */
  after?: string | undefined;
  confirm?: boolean | undefined;
}

export interface BulkJobResponse {
  action: string;
  affected: number;
}

// --- WebSocket event types ---

export type JobWsEvent =
  | { type: "status"; status: JobStatus; progress: number }
  | {
      type: "progress";
      step: number;
      steps: number;
      progress: number;
      eta: number | null;
      task?: string;
      textinfo?: string | null;
      stage?: number;
      stage_name?: string;
      stage_count?: number;
      phase?: string | null;
    }
  | {
      type: "cloud_progress";
      phase: CloudJobPhase;
      detail?: string;
      progress?: number;
      position?: number;
      elapsed?: number;
    }
  | { type: "stages"; stages: string[] }
  | { type: "completed"; result: JobResult }
  | { type: "error"; error: string }
  | { type: "cancelled" }
  | { type: "ping" }
  | { type: "ack"; command: string }
  /** The maps made before generation, by client key, and the keys whose
   * processor failed with the reason. Mirrors WsEventMaps. */
  | { type: "maps"; maps: Record<string, string>; failed: Record<string, string> };
