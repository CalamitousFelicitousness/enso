// --- Job request types (discriminated union) ---

import type { ControlRequest } from "./generation";
import type { CloudImageJobParams, CloudChatJobParams, CloudTtsJobParams, CloudSttJobParams, CloudVideoJobParams, CloudJobPhase } from "./cloud";

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

export interface PreprocessJobParams {
  type: "preprocess";
  image: string;
  model: string;
  params?: Record<string, unknown> | undefined;
  priority?: number | undefined;
}

/** Per-model or default detailer overrides. Mirrors DetailerOverrides
 * in enso_api/job_models.py. All fields optional; unset = inherit. */
export interface DetailerOverrides {
  strength?: number;
  steps?: number;
  resolution?: number;
  padding?: number;
  blur?: number;
  conf?: number;
  iou?: number;
  min_size?: number;
  max_size?: number;
  max?: number;
  sigma_adjust?: number;
  sigma_adjust_max?: number;
  segmentation?: boolean;
  include_detections?: boolean;
  merge?: boolean;
  sort?: boolean;
  prompt?: string;
  negative?: string;
  classes?: string;
  augment?: boolean;
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
  cfg_end?: number | undefined;
  override_settings?: Record<string, unknown> | undefined;
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
  model?: string;
  return_mask?: boolean;
  refine?: boolean;
  alpha_matting?: boolean;
  alpha_matting_foreground_threshold?: number;
  alpha_matting_background_threshold?: number;
  alpha_matting_erode_size?: number;
  priority?: number;
}

export type JobRequest =
  | GenerateJobRequest
  | UpscaleJobParams
  | RembgJobParams
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

export interface ImageRef {
  index: number;
  url: string;
  width: number;
  height: number;
  format: string;
  size: number;
}

export interface JobResult {
  images: ImageRef[];
  processed: ImageRef[];
  info: Record<string, unknown>;
  params: Record<string, unknown>;
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
}

// --- Bulk job types ---

export interface BulkJobRequest {
  action: "cancel" | "delete";
  status?: string | undefined;
  type?: string | undefined;
  ids?: string[] | undefined;
  before?: string | undefined;
  confirm?: boolean | undefined;
}

export interface BulkJobResponse {
  action: string;
  affected: number;
}

// --- WebSocket event types ---

export type JobWsEvent =
  | { type: "status"; status: JobStatus; progress: number }
  | { type: "progress"; step: number; steps: number; progress: number; eta: number | null;
      task?: string; textinfo?: string | null;
      stage?: number; stage_name?: string; stage_count?: number; phase?: string | null }
  | { type: "cloud_progress"; phase: CloudJobPhase; detail?: string; progress?: number; position?: number; elapsed?: number }
  | { type: "stages"; stages: string[] }
  | { type: "completed"; result: JobResult }
  | { type: "error"; error: string }
  | { type: "cancelled" }
  | { type: "ping" }
  | { type: "ack"; command: string };
