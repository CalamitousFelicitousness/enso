import type { ControlRequest } from "./generation";

// V1 alias keys for fields whose canonical names differ in the V2 schema.
// Older PNG metadata in user history may carry these.
interface LegacyAliasWire {
  n_iter?: number;
  hr_sampler_name?: string;
  width?: number;
  height?: number;
  diffusers_pag_scale?: number;
  diffusers_pag_adaptive?: number;
}

// V1 flat detailer keys, predating the V2 detailer_defaults block.
interface LegacyDetailerWire {
  detailer_strength?: number;
  detailer_steps?: number;
  detailer_resolution?: number;
  detailer_padding?: number;
  detailer_blur?: number;
  detailer_conf?: number;
  detailer_iou?: number;
  detailer_min_size?: number;
  detailer_max_size?: number;
  detailer_max?: number;
  detailer_sigma_adjust?: number;
  detailer_sigma_adjust_max?: number;
  detailer_segmentation?: boolean;
  detailer_include_detections?: boolean;
  detailer_merge?: boolean;
  detailer_sort?: boolean;
  detailer_prompt?: string;
  detailer_negative?: string;
  detailer_classes?: string;
}

// Legacy upscale-after fields (resize_name_after / scale_by_after / *_after).
interface LegacyUpscaleAfterWire {
  resize_name_after?: string;
  scale_by_after?: number;
  width_after?: number;
  height_after?: number;
}

// Legacy alias for the V1 settings-overrides container.
interface LegacyOverrideWire {
  override_settings?: WireOverrides;
}

// Settings-override container: known wire fields with autocomplete plus an
// index signature to admit free-form settings keys (sd_model_checkpoint, etc.).
export type WireOverrides = WireParams & Record<string, unknown>;

/**
 * Incoming params wire shape for a saved or restored image generation.
 *
 * To extend: when adding a field to ControlRequest, do NOT update this --
 * the field flows in automatically via Partial<ControlRequest>. Update only
 * when adding a legacy alias with no ControlRequest counterpart.
 */
export type WireParams =
  & Partial<ControlRequest>
  & LegacyAliasWire
  & LegacyDetailerWire
  & LegacyUpscaleAfterWire
  & LegacyOverrideWire;

// Video-side wire shape, kept separate from WireParams because the video
// namespaces (engine, fp_*, ltx_*) do not belong in image-restore autocomplete.

interface VideoSharedWire {
  domain?: string;
  type?: string;
  engine?: string;
  model?: string;
  prompt?: string;
  negative?: string;
  width?: number;
  height?: number;
  frames?: number;
  steps?: number;
  seed?: number;
  guidance_scale?: number;
  guidance_true?: number;
  sampler?: number;
  sampler_shift?: number;
  dynamic_shift?: boolean;
  init_strength?: number;
  vae_type?: string;
  vae_tile_frames?: number;
}

interface VideoOutputWire {
  fps?: number;
  interpolate?: number;
  codec?: string;
  format?: string;
  codec_options?: string;
  save_video?: boolean;
  save_frames?: boolean;
  save_safetensors?: boolean;
}

interface FramePackWire {
  fp_variant?: string;
  fp_resolution?: number;
  fp_duration?: number;
  fp_latent_window_size?: number;
  fp_steps?: number;
  fp_shift?: number;
  fp_cfg_scale?: number;
  fp_cfg_distilled?: number;
  fp_cfg_rescale?: number;
  fp_start_weight?: number;
  fp_end_weight?: number;
  fp_vision_weight?: number;
  fp_section_prompt?: string;
  fp_system_prompt?: string;
  fp_teacache?: boolean;
  fp_optimized_prompt?: boolean;
  fp_cfg_zero?: boolean;
  fp_preview?: boolean;
  fp_attention?: string;
  fp_vae_type?: string;
}

interface LtxWire {
  ltx_model?: string;
  ltx_steps?: number;
  ltx_decode_timestep?: number;
  ltx_noise_scale?: number;
  ltx_upsample_enable?: boolean;
  ltx_upsample_ratio?: number;
  ltx_refine_enable?: boolean;
  ltx_refine_strength?: number;
  ltx_condition_strength?: number;
  ltx_audio_enable?: boolean;
}

export type VideoWireParams =
  & VideoSharedWire
  & VideoOutputWire
  & FramePackWire
  & LtxWire;
