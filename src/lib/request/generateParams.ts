import type { GenerationState } from "@/stores/generationStore";
import type { ControlRequest } from "@/api/types/generation";
import type { DetailerMode } from "@/api/types/models";
import { effectiveHires } from "@/lib/hires";
import { snapSize } from "@/lib/sizeCompute";
import { serializeDetailerEntry, stripUndefined } from "./wire";

export interface GenerateParamsContext {
  livePreviews: boolean;
  /** Width and height multiple the loaded model keeps a size at. */
  sizeMultiple: number;
  /** The request sets the loaded pipeline's output size, also from one input image. */
  requestSetsSize: boolean | null;
  /** An image-to-image pass on the loaded pipeline takes a denoising strength. */
  strengthSupported: boolean;
  /** How the detailer runs on the loaded pipeline, "none" when it cannot;
   * null when unknown. */
  detailerMode: DetailerMode | null;
  scripts: {
    selectedScript: string;
    scriptArgs: unknown[];
    alwaysOnOverrides: Record<string, unknown[]>;
  };
}

/** Generation settings as wire fields: everything a generate job carries apart
 * from its input images, control units and override settings. */
export function generationParams(gen: GenerationState, ctx: GenerateParamsContext): ControlRequest {
  const { sizeMultiple, requestSetsSize, strengthSupported, detailerMode, scripts } = ctx;
  const hires = effectiveHires(
    { upscaler: gen.hiresUpscaler, force: gen.hiresForce, denoising: gen.hiresDenoising },
    { pixelInput: requestSetsSize === true, strength: strengthSupported },
  );

  const request: ControlRequest = {
    prompt: gen.prompt,
    negative_prompt: gen.negativePrompt,
    styles: gen.styles,
    sampler_name: gen.sampler,
    steps: gen.steps,
    // A model loaded for this job can take a coarser multiple than the canvas has snapped to yet
    width_before: snapSize(gen.width, sizeMultiple),
    height_before: snapSize(gen.height, sizeMultiple),
    cfg_scale: gen.cfgScale,
    save_images: true,
    live_previews: ctx.livePreviews,
    cfg_stop: gen.cfgEnd,
    cfg_rescale: gen.guidanceRescale,
    cfg_image: gen.imageCfgScale,
    // 0 on the slider keeps the model default, which the server reads from -1
    cfg_true: gen.pagScale > 0 ? gen.pagScale : -1,
    cfg_adaptive: gen.pagAdaptive,
    seed: gen.seed,
    subseed: gen.subseed,
    subseed_strength: gen.subseedStrength,
    batch_size: gen.batchSize,
    batch_count: gen.batchCount,
    denoising_strength: gen.denoisingStrength,
    enable_hr: gen.hiresEnabled,
    hr_upscaler: hires.upscaler,
    hr_scale: gen.hiresScale,
    hr_second_pass_steps: gen.hiresSteps,
    hr_denoising_strength: hires.denoising,
    hr_force: hires.force,
    // Scale mode (resize_x/y == 0): pure direct resize via mode 1. Fixed mode: user's fit choice.
    // Mode 0 is SD.Next's "disabled" sentinel and would skip the upscale step entirely.
    hr_resize_mode: gen.hiresResizeX === 0 && gen.hiresResizeY === 0 ? 1 : gen.hiresResizeMode,
    hr_resize_x: gen.hiresResizeX,
    hr_resize_y: gen.hiresResizeY,
    hr_resize_context: gen.hiresResizeContext,
    // Post-generation upscale (pure upscaler, no diffusion - runs after hires fix)
    ...(gen.upscaleAfterEnabled && gen.upscaleAfterUpscaler !== "None"
      ? {
          resize_name_after: gen.upscaleAfterUpscaler,
          ...(gen.upscaleAfterResizeMode === 0
            ? { scale_by_after: gen.upscaleAfterScale }
            : {
                resize_mode_after: 1,
                width_after: gen.upscaleAfterWidth,
                height_after: gen.upscaleAfterHeight,
              }),
        }
      : {}),
    ...(gen.refinerEnabled
      ? { refiner_steps: gen.refinerSteps, refiner_start: gen.refinerStart }
      : {}),
    // The hires pass and the refiner both take these in place of the main prompt
    ...(gen.refinerEnabled || gen.hiresEnabled
      ? {
          refiner_prompt: gen.refinerPrompt || undefined,
          refiner_negative: gen.refinerNegative || undefined,
        }
      : {}),
    clip_skip: gen.clipSkip,
    vae_type: gen.vaeType,
    tiling: gen.tiling,
    hidiffusion: gen.hidiffusion,
    hdr_mode: gen.hdrMode,
    hdr_brightness: gen.hdrBrightness,
    hdr_sharpen: gen.hdrSharpen,
    hdr_color: gen.hdrColor,
    hdr_clamp: gen.hdrClamp,
    hdr_boundary: gen.hdrBoundary,
    hdr_threshold: gen.hdrThreshold,
    hdr_maximize: gen.hdrMaximize,
    hdr_max_center: gen.hdrMaxCenter,
    hdr_max_boundary: gen.hdrMaxBoundary,
    hdr_color_picker: gen.hdrColorPicker,
    hdr_tint_ratio: gen.hdrTintRatio,
    hdr_apply_hires: gen.hdrApplyHires,
    grading_brightness: gen.gradingBrightness,
    grading_contrast: gen.gradingContrast,
    grading_saturation: gen.gradingSaturation,
    grading_hue: gen.gradingHue,
    grading_gamma: gen.gradingGamma,
    grading_sharpness: gen.gradingSharpness,
    grading_color_temp: gen.gradingColorTemp,
    grading_shadows: gen.gradingShadows,
    grading_midtones: gen.gradingMidtones,
    grading_highlights: gen.gradingHighlights,
    grading_clahe_clip: gen.gradingClaheClip,
    grading_clahe_grid: gen.gradingClaheGrid,
    grading_shadows_tint: gen.gradingShadowsTint,
    grading_highlights_tint: gen.gradingHighlightsTint,
    grading_split_tone_balance: gen.gradingSplitToneBalance,
    grading_vignette: gen.gradingVignette,
    grading_grain: gen.gradingGrain,
    grading_lut_file: gen.gradingLutFile || undefined,
    grading_lut_strength: gen.gradingLutStrength,
    img2img_color_correction: gen.colorCorrectionEnabled,
    color_correction_method: gen.colorCorrectionMethod,
    schedulers_sigma: gen.sigmaMethod,
    schedulers_timestep_spacing: gen.timestepSpacing,
    schedulers_beta_schedule: gen.betaSchedule,
    schedulers_prediction_type: gen.predictionMethod,
    schedulers_shift: gen.flowShift,
    schedulers_base_shift: gen.baseShift,
    schedulers_max_shift: gen.maxShift,
    schedulers_sigma_adjust: gen.sigmaAdjust,
    schedulers_sigma_adjust_min: gen.sigmaAdjustStart,
    schedulers_sigma_adjust_max: gen.sigmaAdjustEnd,
    schedulers_use_thresholding: gen.thresholding,
    schedulers_dynamic_shift: gen.dynamic,
    schedulers_rescale_betas: gen.rescale,
    schedulers_use_loworder: gen.lowOrder,
    ...(gen.timestepsOverride ? { schedulers_timesteps: gen.timestepsOverride } : {}),
    ...(gen.freeuEnabled
      ? {
          freeu_enabled: true,
          freeu_b1: gen.freeuB1,
          freeu_b2: gen.freeuB2,
          freeu_s1: gen.freeuS1,
          freeu_s2: gen.freeuS2,
        }
      : {}),
    ...(gen.hypertileUnetEnabled
      ? {
          hypertile_unet_enabled: true,
          hypertile_hires_only: gen.hypertileHiresOnly,
          hypertile_unet_tile: gen.hypertileUnetTile,
          hypertile_unet_min_tile: gen.hypertileUnetMinTile,
          hypertile_unet_swap_size: gen.hypertileUnetSwapSize,
          hypertile_unet_depth: gen.hypertileUnetDepth,
        }
      : {}),
    ...(gen.hypertileVaeEnabled
      ? {
          hypertile_vae_enabled: true,
          hypertile_vae_tile: gen.hypertileVaeTile,
          hypertile_vae_swap_size: gen.hypertileVaeSwapSize,
        }
      : {}),
    ...(gen.teacacheEnabled
      ? {
          teacache_enabled: true,
          teacache_thresh: gen.teacacheThresh,
        }
      : {}),
    ...(gen.tokenMergingMethod !== "None"
      ? {
          token_merging_method: gen.tokenMergingMethod,
          tome_ratio: gen.tomeRatio,
          todo_ratio: gen.todoRatio,
        }
      : {}),
  };

  // Detailer (V2 schema: defaults block + per-model entries)
  if (gen.detailerEnabled && detailerMode !== "none") {
    request.detailer_enabled = true;
    request.detailer_defaults = stripUndefined(gen.detailerDefaults);
    request.detailer_models = gen.detailerModels.map(serializeDetailerEntry);
  }

  // Scripts
  if (scripts.selectedScript) {
    request.script_name = scripts.selectedScript;
    request.script_args = scripts.scriptArgs;
  }
  const alwaysOnKeys = Object.keys(scripts.alwaysOnOverrides);
  if (alwaysOnKeys.length > 0) {
    request.alwayson_scripts = {};
    for (const name of alwaysOnKeys) {
      request.alwayson_scripts[name] = { args: scripts.alwaysOnOverrides[name] };
    }
  }

  return request;
}
