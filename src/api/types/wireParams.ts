import type { ControlRequest } from "./generation";
import type { FramePackParams, LtxParams, VideoParams } from "@/lib/openapi-generated/types.gen";

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
export type WireParams = Partial<ControlRequest> &
  LegacyAliasWire &
  LegacyDetailerWire &
  LegacyUpscaleAfterWire &
  LegacyOverrideWire;

// Video-side wire shape: the union of the three video job params echoes,
// kept separate from WireParams because the video vocabulary does not belong
// in image-restore autocomplete. `type` is a per-job Literal (their
// intersection is never) and is excluded from the echo server-side anyway.
export type VideoWireParams = Partial<
  Omit<VideoParams, "type"> & Omit<LtxParams, "type"> & Omit<FramePackParams, "type">
>;
