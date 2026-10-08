// The settings a job ran with, read back into generation state: from the
// request the job was sent with, the image the user picked and what the
// server recorded when it ran.

import type { GenerationResult, GenerationState } from "@/stores/generationStore";
import type { GenerationInfo } from "@/api/types/generation";
import type { DetailerModelEntry, DetailerOverrides, JobStatus } from "@/api/types/v2";
import type { WireOverrides, WireParams } from "@/api/types/wireParams";
import { DEFAULT_HIRES_UPSCALER } from "@/lib/hires";
import type { StoredJob } from "@/lib/inputs/stored";
import type { ActionReason } from "@/lib/jobs/cardActions";
import { isTerminal } from "@/lib/jobs/domains";
import { isUploadRef } from "@/lib/jobs/replay";
import type { RestoreNote } from "@/lib/jobs/text";

/** What settings are read from: the request, what the server recorded, and
 * which of the job's images was picked. */
export interface SettingsSource {
  parameters: WireParams;
  info: GenerationInfo | null;
  imageIndex: number;
}

export interface ExtractedSettings {
  params: Partial<GenerationState>;
  /** The inpainting fields the Initial frame's settings keep. */
  img2img: { maskApplyOverlay?: boolean; inpaintingMaskWeight?: number };
  /** What could not be restored, for the notice. */
  notes: RestoreNote[];
}

const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const maybeNum = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** The entry of a per-image list for the picked image. */
function picked(list: unknown, index: number): number | undefined {
  return Array.isArray(list) ? maybeNum(list[index]) : undefined;
}

/** The server's info for a result, stored as JSON text. */
export function parseInfo(text: string | undefined): GenerationInfo | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as GenerationInfo)
      : null;
  } catch {
    return null;
  }
}

/** The seed and variation seed of the picked image: as the server recorded
 * them for it, else for the job, else as sent. */
export function pickedSeeds(
  p: WireParams,
  info: GenerationInfo | null,
  imageIndex: number,
): { seed: number; subseed: number } {
  return {
    seed: picked(info?.all_seeds, imageIndex) ?? maybeNum(info?.seed) ?? num(p.seed, -1),
    subseed:
      picked(info?.all_subseeds, imageIndex) ?? maybeNum(info?.subseed) ?? num(p.subseed, -1),
  };
}

/** Generation settings from a job's request, without applying them. */
export function extractParams(source: SettingsSource): ExtractedSettings {
  const { parameters: p, info, imageIndex } = source;
  const overrides: WireOverrides = p.extra ?? p.override_settings ?? {};
  const notes: RestoreNote[] = [];
  const { seed, subseed } = pickedSeeds(p, info, imageIndex);
  if (seed < 0) notes.push("seedNotRecorded");
  // A LUT goes out as an upload, which the server forgets 30 minutes later
  const lutExpired = isUploadRef(p.grading_lut_file);
  if (lutExpired) notes.push("lutNotRestored");

  const params: Partial<GenerationState> = {
    // Prompt
    prompt: str(p.prompt, ""),
    negativePrompt: str(p.negative_prompt, ""),
    styles: Array.isArray(p.styles) ? p.styles : [],

    // Sampler
    sampler: str(p.sampler_name, "Euler"),
    steps: num(p.steps, 20),

    // Resolution - control uses width_before/height_before, legacy uses width/height
    width: num(p.width_before ?? p.width, 1024),
    height: num(p.height_before ?? p.height, 1024),

    // Batch - control uses batch_count, legacy uses n_iter
    batchSize: num(p.batch_size, 1),
    batchCount: num(p.batch_count ?? p.n_iter, 1),

    // Guidance - control_run's names, then the V2 names before them, then the legacy diffusers_ prefix
    cfgScale: num(p.cfg_scale, 7),
    cfgEnd: num(p.cfg_stop ?? p.cfg_end, 1),
    guidanceRescale: num(p.cfg_rescale ?? p.diffusers_guidance_rescale, 0),
    imageCfgScale: num(p.cfg_image ?? p.image_cfg_scale, 6),
    pagScale: Math.max(0, num(p.cfg_true ?? p.pag_scale ?? p.diffusers_pag_scale, 0)),
    pagAdaptive: num(p.cfg_adaptive ?? p.pag_adaptive ?? p.diffusers_pag_adaptive, 0.5),
    denoisingStrength: num(p.denoising_strength, 0.5),

    seed,
    subseed,
    subseedStrength: num(p.subseed_strength, 0),

    // Hires
    hiresEnabled: bool(p.enable_hr, false),
    hiresUpscaler: str(p.hr_upscaler, DEFAULT_HIRES_UPSCALER),
    hiresScale: num(p.hr_scale, 2),
    hiresSteps: num(p.hr_second_pass_steps, 0),
    hiresDenoising: num(p.hr_denoising_strength, 0.5),
    hiresSampler: str(p.hr_sampler_name, ""),
    hiresForce: bool(p.hr_force, false),
    hiresResizeMode: num(p.hr_resize_mode, 2),
    hiresResizeX: num(p.hr_resize_x, 0),
    hiresResizeY: num(p.hr_resize_y, 0),
    hiresResizeContext: str(p.hr_resize_context, "None"),

    // Post-generation upscale
    upscaleAfterEnabled: p.resize_name_after != null && p.resize_name_after !== "None",
    upscaleAfterUpscaler: str(p.resize_name_after, "None"),
    upscaleAfterScale: num(p.scale_by_after, 2),
    upscaleAfterResizeMode: num(p.width_after, 0) > 0 || num(p.height_after, 0) > 0 ? 1 : 0,
    upscaleAfterWidth: num(p.width_after, 0),
    upscaleAfterHeight: num(p.height_after, 0),

    // Refiner
    refinerEnabled: num(p.refiner_start, 0) > 0 || num(p.refiner_steps, 0) > 0,
    refinerSteps: num(p.refiner_steps, 0),
    refinerStart: num(p.refiner_start, 0),
    refinerPrompt: str(p.refiner_prompt, ""),
    refinerNegative: str(p.refiner_negative, ""),

    // Advanced
    clipSkip: num(p.clip_skip, 1),
    vaeType: str(p.vae_type, "Full"),
    tiling: bool(p.tiling, false),
    hidiffusion: bool(p.hidiffusion, false),

    // Generation modifiers (hijack)
    freeuEnabled: bool(p.freeu_enabled, false),
    freeuB1: num(p.freeu_b1, 1.2),
    freeuB2: num(p.freeu_b2, 1.4),
    freeuS1: num(p.freeu_s1, 0.9),
    freeuS2: num(p.freeu_s2, 0.2),
    hypertileUnetEnabled: bool(p.hypertile_unet_enabled, false),
    hypertileHiresOnly: bool(p.hypertile_hires_only, false),
    hypertileUnetTile: num(p.hypertile_unet_tile, 0),
    hypertileUnetMinTile: num(p.hypertile_unet_min_tile, 0),
    hypertileUnetSwapSize: num(p.hypertile_unet_swap_size, 1),
    hypertileUnetDepth: num(p.hypertile_unet_depth, 0),
    hypertileVaeEnabled: bool(p.hypertile_vae_enabled, false),
    hypertileVaeTile: num(p.hypertile_vae_tile, 128),
    hypertileVaeSwapSize: num(p.hypertile_vae_swap_size, 1),
    teacacheEnabled: bool(p.teacache_enabled, false),
    teacacheThresh: num(p.teacache_thresh, 0.15),
    tokenMergingMethod: str(p.token_merging_method, "None"),
    tomeRatio: num(p.tome_ratio, 0.0),
    todoRatio: num(p.todo_ratio, 0.0),

    // Color correction
    colorCorrectionEnabled: bool(p.img2img_color_correction, false),
    colorCorrectionMethod: str(p.color_correction_method, "histogram"),

    // Latent corrections
    hdrMode: num(p.hdr_mode, 0),
    hdrBrightness: num(p.hdr_brightness, 0),
    hdrSharpen: num(p.hdr_sharpen, 0),
    hdrColor: num(p.hdr_color, 0),
    hdrClamp: bool(p.hdr_clamp, false),
    hdrBoundary: num(p.hdr_boundary, 4.0),
    hdrThreshold: num(p.hdr_threshold, 0.95),
    hdrMaximize: bool(p.hdr_maximize, false),
    hdrMaxCenter: num(p.hdr_max_center, 0.6),
    hdrMaxBoundary: num(p.hdr_max_boundary, 1.0),
    hdrColorPicker: str(p.hdr_color_picker, "#000000"),
    hdrTintRatio: num(p.hdr_tint_ratio, 0),
    hdrApplyHires: p.hdr_apply_hires !== false,

    // Color grading
    gradingBrightness: num(p.grading_brightness, 0),
    gradingContrast: num(p.grading_contrast, 0),
    gradingSaturation: num(p.grading_saturation, 0),
    gradingHue: num(p.grading_hue, 0),
    gradingGamma: num(p.grading_gamma, 1.0),
    gradingSharpness: num(p.grading_sharpness, 0),
    gradingColorTemp: num(p.grading_color_temp, 6500),
    gradingShadows: num(p.grading_shadows, 0),
    gradingMidtones: num(p.grading_midtones, 0),
    gradingHighlights: num(p.grading_highlights, 0),
    gradingClaheClip: num(p.grading_clahe_clip, 0),
    gradingClaheGrid: num(p.grading_clahe_grid, 8),
    gradingShadowsTint: str(p.grading_shadows_tint, "#000000"),
    gradingHighlightsTint: str(p.grading_highlights_tint, "#ffffff"),
    gradingSplitToneBalance: num(p.grading_split_tone_balance, 0.5),
    gradingVignette: num(p.grading_vignette, 0),
    gradingGrain: num(p.grading_grain, 0),
    ...(lutExpired ? {} : { gradingLutFile: str(p.grading_lut_file, "") }),
    gradingLutStrength: num(p.grading_lut_strength, 1.0),

    // Detailer enable flag (V2 + legacy share this one)
    detailerEnabled: bool(p.detailer_enabled, false),

    // Scheduler overrides (top-level in new API, overrides dict in legacy)
    sigmaMethod: str(p.schedulers_sigma ?? overrides.schedulers_sigma, "default"),
    timestepSpacing: str(
      p.schedulers_timestep_spacing ?? overrides.schedulers_timestep_spacing,
      "default",
    ),
    betaSchedule: str(p.schedulers_beta_schedule ?? overrides.schedulers_beta_schedule, "default"),
    predictionMethod: str(
      p.schedulers_prediction_type ?? overrides.schedulers_prediction_type,
      "default",
    ),
    flowShift: num(p.schedulers_shift ?? overrides.schedulers_shift, 3),
    baseShift: num(p.schedulers_base_shift ?? overrides.schedulers_base_shift, 0.5),
    maxShift: num(p.schedulers_max_shift ?? overrides.schedulers_max_shift, 1.15),
    sigmaAdjust: num(p.schedulers_sigma_adjust ?? overrides.schedulers_sigma_adjust, 1.0),
    sigmaAdjustStart: num(
      p.schedulers_sigma_adjust_min ?? overrides.schedulers_sigma_adjust_min,
      0.2,
    ),
    sigmaAdjustEnd: num(
      p.schedulers_sigma_adjust_max ?? overrides.schedulers_sigma_adjust_max,
      1.0,
    ),
    thresholding: bool(
      p.schedulers_use_thresholding ?? overrides.schedulers_use_thresholding,
      false,
    ),
    dynamic: bool(p.schedulers_dynamic_shift ?? overrides.schedulers_dynamic_shift, false),
    rescale: bool(p.schedulers_rescale_betas ?? overrides.schedulers_rescale_betas, false),
    lowOrder: bool(p.schedulers_use_loworder ?? overrides.schedulers_use_loworder, true),
    timestepsOverride: str(p.schedulers_timesteps ?? overrides.schedulers_timesteps, ""),
    timestepsPreset: "None",

    // Detailer V2: defaults block + per-model entries.
    // Reads V2 shape directly; falls back to legacy flat fields when restoring
    // a result generated before the V2 cutover (PNG-info on disk, etc.).
    ...(p.detailer_enabled ? extractDetailerV2(p, overrides) : {}),
  };

  const img2img: ExtractedSettings["img2img"] = {};
  if (typeof p.mask_apply_overlay === "boolean") img2img.maskApplyOverlay = p.mask_apply_overlay;
  if (typeof p.inpainting_mask_weight === "number") {
    img2img.inpaintingMaskWeight = p.inpainting_mask_weight;
  }
  return { params, img2img, notes };
}

/** Build the V2 detailerDefaults + detailerModels from a result's parameters.
 * Accepts both V2-shaped and legacy-flat inputs. */
function extractDetailerV2(
  p: WireParams,
  overrides: WireOverrides,
): Pick<GenerationState, "detailerDefaults" | "detailerModels"> {
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
  const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

  // Prefer V2 defaults block if present
  const v2Defaults: DetailerOverrides | undefined =
    p.detailer_defaults ?? overrides.detailer_defaults;
  const defaults: DetailerOverrides =
    v2Defaults && typeof v2Defaults === "object"
      ? v2Defaults
      : {
          // Legacy: hoist flat detailer_* fields into the defaults block
          strength: num(p.detailer_strength ?? overrides.detailer_strength),
          steps: num(p.detailer_steps ?? overrides.detailer_steps),
          resolution: num(p.detailer_resolution ?? overrides.detailer_resolution),
          padding: num(p.detailer_padding ?? overrides.detailer_padding),
          blur: num(p.detailer_blur ?? overrides.detailer_blur),
          conf: num(p.detailer_conf ?? overrides.detailer_conf),
          iou: num(p.detailer_iou ?? overrides.detailer_iou),
          min_size: num(p.detailer_min_size ?? overrides.detailer_min_size),
          max_size: num(p.detailer_max_size ?? overrides.detailer_max_size),
          max: num(p.detailer_max ?? overrides.detailer_max),
          sigma_adjust: num(p.detailer_sigma_adjust ?? overrides.detailer_sigma_adjust),
          sigma_adjust_max: num(p.detailer_sigma_adjust_max ?? overrides.detailer_sigma_adjust_max),
          segmentation: bool(p.detailer_segmentation ?? overrides.detailer_segmentation),
          include_detections: bool(
            p.detailer_include_detections ?? overrides.detailer_include_detections,
          ),
          merge: bool(p.detailer_merge ?? overrides.detailer_merge),
          sort: bool(p.detailer_sort ?? overrides.detailer_sort),
          prompt: str(p.detailer_prompt ?? overrides.detailer_prompt),
          negative: str(p.detailer_negative ?? overrides.detailer_negative),
          classes: str(p.detailer_classes ?? overrides.detailer_classes),
        };

  // detailer_models entries can be bare strings or objects on the wire
  const rawModels = p.detailer_models ?? overrides.detailer_models;
  const models: DetailerModelEntry[] = Array.isArray(rawModels)
    ? rawModels.flatMap((m): DetailerModelEntry[] => {
        if (typeof m === "string") return [{ name: m }];
        if (m && typeof m === "object" && typeof m.name === "string") {
          return [m];
        }
        return [];
      })
    : [{ name: "face-yolo8n" }];

  return { detailerDefaults: defaults, detailerModels: models };
}

export type SettingsAnswer =
  { ok: true; source: SettingsSource } | { ok: false; reason: ActionReason };

/** A job as the server lists it, as far as settings go. */
export interface SettingsJob {
  type: string;
  status: JobStatus;
  result: { params: Record<string, unknown>; info: Record<string, unknown> } | null;
}

/** Where a job's settings come from: the request this browser recorded
 * when it sent the job, whatever became of it, with the server's info once
 * it completed; else the request a completed job came back with. Only a
 * local image generation's settings restore. */
export function settingsSourceOf(
  record: Pick<StoredJob, "request"> | null,
  job: SettingsJob,
  imageIndex: number,
): SettingsAnswer {
  if (job.type !== "generate") return { ok: false, reason: "notGenerate" };
  // The server returns snake_case JSON; reading it as WireParams crosses the wire boundary
  const info = (job.result?.info as GenerationInfo | undefined) ?? null;
  if (record) {
    const { type: _type, ...parameters } = record.request;
    return { ok: true, source: { parameters, info, imageIndex } };
  }
  if (job.status === "completed" && job.result) {
    return { ok: true, source: { parameters: job.result.params, info, imageIndex } };
  }
  return { ok: false, reason: isTerminal(job.status) ? "noRecord" : "unfinished" };
}

/** A strip result's settings. A result without a type predates the field
 * and was an image generation. */
export function resultSettings(
  result: Pick<GenerationResult, "parameters" | "info"> & { type?: string | undefined },
  imageIndex: number,
): SettingsAnswer {
  if (result.type !== undefined && result.type !== "generate") {
    return { ok: false, reason: "notGenerate" };
  }
  return {
    ok: true,
    source: { parameters: result.parameters, info: parseInfo(result.info), imageIndex },
  };
}
