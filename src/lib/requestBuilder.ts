// WYSIWYG request assembly - bridges the canvas UI state and the backend API.
//
// For img2img: visible canvas layers are flattened into a single image at frame
// resolution via flattenCanvas(), then uploaded as the init image. The backend
// receives exactly what the user sees inside the generation frame. Several
// input slots go out as one condition set in canvas order.
// See flattenCanvas.ts and resize.ts for the compositing and resize pipeline.

import { useGenerationStore } from "@/stores/generationStore";
import type { GenerationResult, GenerationState } from "@/stores/generationStore";
import { useScriptStore } from "@/stores/scriptStore";
import { useControlStore, resolveUnitImage } from "@/stores/controlStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useCanvasStore, type ImageLayer, type MaskObjectLayer } from "@/stores/canvasStore";
import { useUiStore } from "@/stores/uiStore";
import { exportMask } from "@/lib/exportMask";
import { flattenCanvas, compositeControlImage, compositeFitImage } from "@/lib/flattenCanvas";
import { uploadFiles, uploadBlob, uploadFile } from "@/lib/upload";
import { base64ToBlob } from "@/lib/utils";
import { REFERENCE_HEIGHT } from "@/canvas/useControlFrameLayout";
import { sourceImageSize, wireSources, type WireSource } from "@/canvas/inputFrames";
import { DEFAULT_HIRES_UPSCALER, effectiveHires } from "@/lib/hires";
import {
  DEFAULT_SIZE_MULTIPLE,
  effectiveSizeMode,
  imageOutputSize,
  resolveGenerationSize,
  serverSizesFromImage,
  snapSize,
} from "@/lib/sizeCompute";
import type { ControlRequest, GenerationInfo } from "@/api/types/generation";
import type { DetailerModelEntry, DetailerModelRef, DetailerOverrides } from "@/api/types/v2";
import type { DetailerMode } from "@/api/types/models";
import { BACKEND_UNIT_TYPE } from "@/api/types/control";
import type { WireParams, WireOverrides } from "@/api/types/wireParams";

export interface BuildResult {
  request: ControlRequest;
  inputBlob?: Blob | undefined;
}

export interface ControlBuildOptions {
  /** Most input images the loaded model takes in one request; null when unknown. */
  maxInputImages: number | null;
  /** The request sets the loaded pipeline's output size, also from one input image. */
  requestSetsSize: boolean | null;
  /** Width and height multiple the loaded model keeps a size at. */
  sizeMultiple: number;
  /** The canvas showed a lone Reference at the image's size, from the model
   * it knew before any load for this job (referenceSetsSize). */
  referenceSets: boolean;
  /** An image-to-image pass on the loaded pipeline takes a denoising strength. */
  strengthSupported: boolean;
  /** How the detailer runs on the loaded pipeline, "none" when it cannot;
   * null when unknown. */
  detailerMode: DetailerMode | null;
}

/** The canvas holds inputs the loaded model cannot take as they are. */
export class InputRefusal extends Error {
  override name = "InputRefusal";
}

/** Strip undefined-valued keys so the wire payload stays minimal.
 * Empty-string text fields are treated as "inherit" too - the V2 schema
 * uses absence to mean inheritance, and an empty override is meaningless. */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (typeof v === "string" && v === "") continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/** Serialize a DetailerModelEntry. If only `name` is set, returns the
 * bare string shorthand so the backend doesn't need to unwrap an object. */
function serializeDetailerEntry(entry: DetailerModelEntry): DetailerModelRef {
  const stripped = stripUndefined(entry);
  const keys = Object.keys(stripped);
  if (keys.length === 1 && keys[0] === "name" && stripped.name) return stripped.name;
  return stripped as DetailerModelEntry;
}

/** Why the inputs cannot go out as one set: the model's limit, and settings the
 * server applies only to a processed input. */
function conditionSetRefusals(
  sources: WireSource[],
  maxInputImages: number | null,
  gen: GenerationState,
  sendsControlUnits: boolean,
): string[] {
  const reasons: string[] = [];
  if (maxInputImages != null && sources.length > maxInputImages) {
    const takes = maxInputImages === 1 ? "one input image" : `up to ${maxInputImages} input images`;
    reasons.push(`The loaded model takes ${takes}; the canvas holds ${sources.length}`);
  }
  const hasMask = sources.some(
    (s) =>
      s.kind === "initial" &&
      (s.frame.maskLines.length > 0 || s.frame.layers.some((l) => l.type === "mask")),
  );
  const settings: [string, boolean][] = [
    ["mask", hasMask],
    ["control units", sendsControlUnits],
    ["checkpoint override", "sd_model_checkpoint" in gen.overrideSettings],
  ];
  const conflicts = settings.filter(([, on]) => on).map(([label]) => label);
  if (conflicts.length > 0) {
    const inputs = sources.length > 1 ? "several input images" : "a Reference image";
    reasons.push(`Not available with ${inputs}: ${conflicts.join(", ")}`);
  }
  return reasons;
}

/** Several slots as one condition set, in slot order: Initial slots flattened and
 * resized to the output size here, references raw. Returns the first Initial
 * slot at frame size for the job snapshot. */
async function addConditionSet(
  request: ControlRequest,
  sources: WireSource[],
  gen: GenerationState,
  target: { width: number; height: number },
): Promise<Blob | undefined> {
  let snapshotImage: Blob | undefined;
  const refs: string[] = [];
  for (const source of sources) {
    if (source.kind === "reference") {
      refs.push(await uploadFile(source.reference.file));
      continue;
    }
    const flat = await flattenCanvas(source.layers, gen.width, gen.height);
    if (!flat) throw new Error("Failed to flatten an input frame");
    snapshotImage ??= flat;
    refs.push(await uploadBlob(await resizeBlob(flat, target.width, target.height), "input.png"));
  }
  request.inputs = refs;
  request.skip_processing = true;
  request.input_type = 1;
  request.width_before = target.width;
  request.height_before = target.height;
  // QwenImageEditPlusPipeline refuses batch_size above 1
  request.batch_count = gen.batchCount * gen.batchSize;
  request.batch_size = 1;
  return snapshotImage;
}

export async function buildControlRequest({
  maxInputImages,
  requestSetsSize,
  sizeMultiple,
  referenceSets,
  strengthSupported,
  detailerMode,
}: ControlBuildOptions): Promise<BuildResult> {
  const gen = useGenerationStore.getState();
  const scripts = useScriptStore.getState();
  const control = useControlStore.getState();
  const img2img = useImg2ImgStore.getState();
  const canvas = useCanvasStore.getState();
  const ui = useUiStore.getState();

  // One entry per image the canvas numbers, in that order. Several go out as one
  // condition set, and so does a lone Reference on a pipeline whose output size
  // the request sets. A single slot otherwise keeps the img2img and
  // raw-reference paths.
  const sources = wireSources(canvas.inputFrames);
  const slots = sources.map((s) => s.slot);
  const loneReference = sources.length === 1 && sources[0].kind === "reference";
  const asSet = sources.length > 1 || (loneReference && requestSetsSize === true);
  // The frame showed the lone Reference's own size, so that size is sent
  const shownFromImage = serverSizesFromImage(slots, referenceSets);
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
    live_previews: ui.livePreviews,
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

  // Control units: partition by type - IP-adapter vs control types
  const enabledIPUnits = control.units.filter(
    (u) => u.enabled && u.unitType === "ip" && u.images.length > 0,
  );

  // Resolve images for control units (may reference another unit's image via "unit:N")
  const controlUnitEntries = control.units
    .map((u, i) => ({ unit: u, image: resolveUnitImage(control.units, i) }))
    .filter((e) => e.unit.enabled && e.unit.unitType !== "ip" && e.image);

  if (asSet) {
    const sendsControlUnits = controlUnitEntries.length > 0 || enabledIPUnits.length > 0;
    const reasons = conditionSetRefusals(sources, maxInputImages, gen, sendsControlUnits);
    if (reasons.length > 0) throw new InputRefusal(`${reasons.join(". ")}.`);
  }

  if (enabledIPUnits.length > 0) {
    request.ip_adapter = await Promise.all(
      enabledIPUnits.map(async (u) => ({
        adapter: u.adapter,
        scale: u.scale,
        crop: u.crop,
        start: u.start,
        end: u.end,
        images: await uploadFiles(u.images),
        masks: u.masks.length > 0 ? await uploadFiles(u.masks) : undefined,
      })),
    );
  }

  // Compute display scale for free-mode compositing
  const displayScale = gen.height > 0 ? REFERENCE_HEIGHT / gen.height : 1;

  if (controlUnitEntries.length > 0) {
    const reprocess = ui.reprocessOnGenerate;
    request.control = await Promise.all(
      controlUnitEntries.map(async (e) => {
        // When reprocess is off and a manual preview exists, send the processed image
        // as override with process=None so the backend uses it as-is.
        const hasManualPreview = !reprocess && e.unit.processedImage;
        let overrideRef: string | undefined;
        if (hasManualPreview) {
          const resp = await fetch(e.unit.processedImage!);
          const blob = await resp.blob();
          overrideRef = await uploadBlob(blob, "processed.png");
        } else if (e.unit.fitMode === "free" && e.image) {
          // Free mode: composite the image at generation resolution before uploading
          const ft = e.unit.freeTransform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
          const composed = await compositeControlImage(
            e.image,
            ft,
            gen.width,
            gen.height,
            displayScale,
          );
          overrideRef = await uploadBlob(composed, "control.png");
        } else if (e.image) {
          // WYSIWYG: composite the image using the fit mode so what's sent matches what's on canvas
          const composed = await compositeFitImage(e.image, gen.width, gen.height, e.unit.fitMode);
          overrideRef = await uploadBlob(composed, "control.png");
        }
        return {
          process: hasManualPreview ? "None" : e.unit.processor,
          model: e.unit.model,
          strength: e.unit.strength,
          start: e.unit.start,
          end: e.unit.end,
          override: overrideRef,
          unit_type: BACKEND_UNIT_TYPE[e.unit.unitType] ?? e.unit.unitType,
          mode: e.unit.mode,
          ...(e.unit.unitType === "controlnet" ? { guess: e.unit.guess } : {}),
          ...(e.unit.unitType === "t2i" ? { factor: e.unit.factor } : {}),
          ...(e.unit.unitType === "style_transfer"
            ? {
                attention: e.unit.attention,
                fidelity: e.unit.fidelity,
                query_weight: e.unit.queryWeight,
                adain_weight: e.unit.adainWeight,
              }
            : {}),
          ...(Object.keys(e.unit.processorParams).length > 0 && !hasManualPreview
            ? { process_params: e.unit.processorParams }
            : {}),
        };
      }),
    );
  }

  let inputBlob: Blob | undefined;
  const primary: WireSource | undefined = sources[0];
  if (asSet) {
    // The size rule the canvas layout shows, so the size on screen is the size sent
    const target = shownFromImage
      ? imageOutputSize(sourceImageSize(sources[0]), sizeMultiple)
      : resolveGenerationSize(
          effectiveSizeMode(img2img.sizeMode, ui.autoFitFrame, slots, referenceSets),
          gen.width,
          gen.height,
          img2img.scaleFactor,
          img2img.megapixelTarget,
          sizeMultiple,
        );
    inputBlob = await addConditionSet(request, sources, gen, target);
  } else if (primary?.kind === "reference") {
    // The source file as it is. A model that takes one input image generates at
    // the image's size, rounded up to its multiple.
    const size = imageOutputSize(sourceImageSize(primary), sizeMultiple);
    // The canvas showed the Size set, going by what this model reported when it
    // was last loaded; it now reports otherwise.
    if (!shownFromImage) {
      throw new InputRefusal(
        `The loaded model generates at the size of its input image, ${size.width}×${size.height}, and Size now shows that. Generate again to use it.`,
      );
    }
    request.inputs = [await uploadFile(primary.reference.file)];
    request.input_type = 1;
    request.width_before = size.width;
    request.height_before = size.height;
    inputBlob = primary.reference.file;
  } else if (primary?.kind === "initial") {
    // img2img: add inputs, mask, inpainting params
    const frameW = gen.width;
    const frameH = gen.height;
    const sizeMode = effectiveSizeMode(
      img2img.sizeMode,
      ui.autoFitFrame,
      [primary.slot],
      referenceSets,
    );
    const genSize = resolveGenerationSize(
      sizeMode,
      frameW,
      frameH,
      img2img.scaleFactor,
      img2img.megapixelTarget,
      sizeMultiple,
    );

    request.width_before = genSize.width;
    request.height_before = genSize.height;
    request.input_type = 1;

    // Flatten the slot's image layers at full frame size.
    const flattenedBlob = await flattenCanvas(primary.layers, frameW, frameH);
    if (flattenedBlob) {
      inputBlob = flattenedBlob;
      const ref = await uploadBlob(flattenedBlob, "input.png");
      request.inputs = [ref];
    }

    // Force resize_mode_before=1 (Fixed) + resize_name_before when the generation
    // size is not the frame's (scale/megapixel, or a coarser size multiple) so the
    // backend resizes the init image to it.
    // Both fields are required: run.py zeros resize_mode when resize_name is 'None'.
    if (genSize.width !== frameW || genSize.height !== frameH) {
      request.resize_mode_before = 1;
      request.resize_name_before = img2img.resizeMethod;
    }

    // Composite the frame's mask objects + any uncommitted strokes.
    const maskObjects = primary.frame.layers.filter((l): l is MaskObjectLayer => l.type === "mask");
    const maskBlob = await exportMask(maskObjects, primary.frame.maskLines, frameW, frameH);
    if (maskBlob) {
      request.mask = await uploadBlob(maskBlob, "mask.png");
      request.mask_blur = img2img.maskBlur;
      request.inpaint_full_res = img2img.inpaintFullRes;
      request.inpaint_full_res_padding = img2img.inpaintFullResPadding;
      request.inpainting_mask_invert = img2img.inpaintingMaskInvert ? 1 : 0;
      request.mask_apply_overlay = img2img.maskApplyOverlay;
      request.inpainting_mask_weight = img2img.inpaintingMaskWeight;
    }
  }

  // User override settings (merged last to take priority)
  if (Object.keys(gen.overrideSettings).length > 0) {
    request.extra = {
      ...request.extra,
      ...gen.overrideSettings,
    };
  }

  return { request, inputBlob };
}

export interface BuildDetailResult {
  request: import("@/api/types/v2").DetailJobParams;
  inputBlob?: Blob;
}

/** Build a "Detail only" job: flatten canvas, upload, request detailer-only pass.
 * The backend will skip encode/base/hires entirely and run only the detailer on the input. */
export async function buildDetailRequest(): Promise<BuildDetailResult> {
  const gen = useGenerationStore.getState();
  const canvas = useCanvasStore.getState();

  // Detail-only sources the first Initial frame's layers (matches the
  // chrome's focused-frame model).
  const primaryFrame = canvas.inputFrames[0] ?? null;
  const imageLayers = primaryFrame?.layers.filter((l): l is ImageLayer => l.type === "image") ?? [];
  if (imageLayers.length === 0) {
    throw new Error("Detail only requires an image on the canvas");
  }

  const flattenedBlob = await flattenCanvas(imageLayers, gen.width, gen.height);
  if (!flattenedBlob) {
    throw new Error("Failed to flatten canvas for detail job");
  }
  const ref = await uploadBlob(flattenedBlob, "input.png");

  const request: import("@/api/types/v2").DetailJobParams = {
    type: "detail",
    inputs: [ref],
    width: gen.width,
    height: gen.height,
    prompt: gen.prompt,
    negative_prompt: gen.negativePrompt,
    seed: gen.seed,
    sampler_name: gen.sampler,
    detailer_enabled: true,
    detailer_defaults: stripUndefined(gen.detailerDefaults),
    detailer_models: gen.detailerModels.map(serializeDetailerEntry),
    save_images: true,
  };

  if (gen.overrideSettings && Object.keys(gen.overrideSettings).length > 0) {
    request.override_settings = { ...gen.overrideSettings };
  }

  return { request, inputBlob: flattenedBlob };
}

/** Extract generation store params from a result without applying them. */
export function extractParamsFromResult(result: GenerationResult): Partial<GenerationState> {
  const p = result.parameters;

  let info: GenerationInfo | null = null;
  try {
    info = JSON.parse(result.info) as GenerationInfo;
  } catch {
    /* ignore */
  }

  const overrides: WireOverrides = p.extra ?? p.override_settings ?? {};

  const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
  const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

  return {
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

    // Seed - use resolved values from info when available
    seed: num(info?.seed ?? p.seed, -1),
    subseed: num(info?.subseed ?? p.subseed, -1),
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
    gradingLutFile: str(p.grading_lut_file, ""),
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

/** Restore generation store state from a previous result. */
export function restoreFromResult(result: GenerationResult): void {
  const params = extractParamsFromResult(result);
  useGenerationStore.getState().setParams(params);

  const p = result.parameters;
  const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);

  // Restore input image and mask if present (img2img history). Target the
  // focused Input frame so the user can compare against their current
  // working state, or the first Initial frame when the focused one is a
  // Reference frame, whose layers are not shown or sent.
  if (result.inputImage) {
    const w = num(p.width_before ?? p.width, 1024);
    const h = num(p.height_before ?? p.height, 1024);
    const canvas = useCanvasStore.getState();
    const active = canvas.inputFrames.find((f) => f.id === canvas.activeInputFrameId);
    const targetFrameId =
      active?.mode === "initial"
        ? active.id
        : (canvas.inputFrames.find((f) => f.mode === "initial")?.id ?? null);
    if (targetFrameId) {
      canvas.restoreImageLayerToFrame(targetFrameId, base64ToBlob(result.inputImage), w, h);

      if (result.inputMask && result.inputMask.length > 0) {
        canvas.clearMaskLinesInFrame(targetFrameId);
        canvas.removeMaskLayersInFrame(targetFrameId);
        for (const line of result.inputMask) {
          canvas.addMaskLineToFrame(targetFrameId, line);
        }
      }
    }
  }

  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

  // Restore mask params
  if (p.mask_apply_overlay !== undefined)
    useImg2ImgStore.getState().setMaskApplyOverlay(bool(p.mask_apply_overlay, true));
  if (p.inpainting_mask_weight !== undefined)
    useImg2ImgStore.getState().setInpaintingMaskWeight(num(p.inpainting_mask_weight, 1.0));

  // Restore control units if present
  if (result.controlUnits && result.controlUnits.length > 0) {
    useControlStore.getState().restoreUnits(result.controlUnits);
  }
}

// --- Cloud image request builder ---

import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { resizeBlob } from "@/lib/resize";
import { getInputLimits } from "@/lib/cloudLimits";
import { optimizeImageForProvider } from "@/lib/imageOptimize";
import type { CloudImageJobParams, CloudModel } from "@/api/types/cloud";

export async function buildCloudImageRequest(): Promise<CloudImageJobParams> {
  const { activeModel } = useModelSelectionStore.getState();
  const gen = useGenerationStore.getState();
  const canvas = useCanvasStore.getState();
  const img2img = useImg2ImgStore.getState();
  const model = activeModel as CloudModel;

  const frameW = gen.width;
  const frameH = gen.height;

  // One image per wire slot, in slot order. Initial slots contribute one
  // flattened+optimized blob each; reference slots upload raw (no flatten,
  // no provider optimization). The primary (first Initial) slot determines
  // strength + mask. Mixed Initial+Reference works - user's "paint Image 1,
  // point at Image 2 as reference" workflow.
  const sources = wireSources(canvas.inputFrames);

  // The primary Initial slot carries strength and the mask; reference-only
  // generations have no strength surface.
  const firstInitial = sources.find((s) => s.kind === "initial") ?? null;

  // The size rule the canvas layout shows
  const slots = sources.map((s) => s.slot);
  const fit = useUiStore.getState().autoFitFrame;
  const targetSize = resolveGenerationSize(
    effectiveSizeMode(img2img.sizeMode, fit, slots, false),
    frameW,
    frameH,
    img2img.scaleFactor,
    img2img.megapixelTarget,
    DEFAULT_SIZE_MULTIPLE,
  );

  // Auto-size modifier: when on, send size="auto" regardless of the model's
  // codified allow_auto value. sdnext's adapter translates per the model's
  // size_constraint.auto_wire when present (literal/omit/default), and the
  // provider is the source of truth about whether "auto" is accepted. Soft
  // pre-flight logs the mismatch via telemetry but lets the
  // request through so the user gets a real provider response.
  const autoEnabled = img2img.autoSize;
  const sizeValue = autoEnabled ? "auto" : `${targetSize.width}x${targetSize.height}`;

  const request: CloudImageJobParams = {
    type: "cloud_image",
    provider: model.provider,
    model: model.id,
    prompt: gen.prompt,
    size: sizeValue,
  };

  if (gen.negativePrompt) request.negative_prompt = gen.negativePrompt;
  if (gen.seed >= 0) request.seed = gen.seed;
  if (gen.batchSize > 1) request.n = gen.batchSize;
  if (gen.cfgScale !== 7) request.guidance = gen.cfgScale;
  if (gen.steps !== 20) request.steps = gen.steps;

  // Track the primary Initial frame's optimized dimensions for mask resize.
  let primaryOptimizedDims: { width: number; height: number } | null = null;
  const imageRefs: string[] = [];

  for (const source of sources) {
    if (source.kind === "reference") {
      // Raw upload, no optimization - sdnext's adapter dispatches per-provider.
      imageRefs.push(await uploadFile(source.reference.file));
      continue;
    }
    // Flatten + optimize + upload this Initial slot's layers.
    let imageBlob = await flattenCanvas(source.layers, frameW, frameH);
    if (!imageBlob) continue;
    const needsResize = targetSize.width !== frameW || targetSize.height !== frameH;
    if (needsResize) {
      imageBlob = await resizeBlob(imageBlob, targetSize.width, targetSize.height);
    }
    const limits = getInputLimits(model.provider, model.id);
    const optimized = await optimizeImageForProvider(imageBlob, limits, model.provider);
    const filename = `cloud-input.${optimized.format}`;
    const ref = await uploadBlob(optimized.blob, filename);
    imageRefs.push(ref);
    if (source === firstInitial) {
      primaryOptimizedDims = optimized.dimensions;
      // The first Initial slot's optimized dimensions can differ from the
      // user-set size when the provider's input limits clip aspect or
      // longest-side. Echo those dims into request.size unless the caller
      // explicitly asked for size="auto".
      if (
        !autoEnabled &&
        (optimized.dimensions.width !== targetSize.width ||
          optimized.dimensions.height !== targetSize.height)
      ) {
        request.size = `${optimized.dimensions.width}x${optimized.dimensions.height}`;
      }
    }
  }

  if (imageRefs.length === 0) {
    // No input images - pure txt2img. Return without setting image/images.
    return request;
  }

  request.images = imageRefs;

  if (firstInitial) {
    // Strength + mask apply when an Initial slot contributes; mask pairs
    // with the primary Initial slot.
    request.strength = gen.denoisingStrength;
    const maskLines = firstInitial.frame.maskLines;
    const maskObjects = firstInitial.frame.layers.filter(
      (l): l is MaskObjectLayer => l.type === "mask",
    );
    if (maskLines.length > 0 || maskObjects.length > 0) {
      let maskBlob = await exportMask(maskObjects, maskLines, frameW, frameH);
      const needsResize = targetSize.width !== frameW || targetSize.height !== frameH;
      if (maskBlob && needsResize) {
        maskBlob = await resizeBlob(maskBlob, targetSize.width, targetSize.height);
      }
      if (
        maskBlob &&
        primaryOptimizedDims &&
        (primaryOptimizedDims.width !== targetSize.width ||
          primaryOptimizedDims.height !== targetSize.height)
      ) {
        maskBlob = await resizeBlob(
          maskBlob,
          primaryOptimizedDims.width,
          primaryOptimizedDims.height,
        );
      }
      if (maskBlob) {
        const maskRef = await uploadBlob(maskBlob, "cloud-mask.png");
        request.mask = maskRef;
      }
    }
  }

  return request;
}

// --- Cloud video request builder ---

import { useVideoStore } from "@/stores/videoStore";
import { supportsImageToVideo } from "@/lib/cloudVideo";
import { getVideoInputs } from "@/lib/video/inputs";
import type { CloudVideoJobParams } from "@/api/types/cloud";

export async function buildCloudVideoRequest(): Promise<CloudVideoJobParams> {
  const { activeModel } = useModelSelectionStore.getState();
  const video = useVideoStore.getState();
  // VideoPanel.canGenerate guards entry on isCloudVideoModel(activeModel), so
  // the cast is safe here. If we're called with a non-cloud-video model,
  // payload.provider/model end up empty and the backend rejects with 4xx.
  const model = activeModel as CloudModel;

  const request: CloudVideoJobParams = {
    type: "cloud_video",
    provider: model.provider,
    model: model.id,
    prompt: video.prompt,
  };

  if (video.cloudAspectRatio) request.aspect_ratio = video.cloudAspectRatio;
  if (video.cloudDuration > 0) request.duration = video.cloudDuration;

  const initImage = getVideoInputs().init;
  if (initImage && supportsImageToVideo(model)) {
    request.image = await uploadFile(initImage);
  }

  return request;
}
