// WYSIWYG request assembly - bridges the canvas UI state and the backend API.
//
// For img2img: visible canvas layers are flattened into a single image at frame
// resolution via flattenCanvas(), then uploaded as the init image. The backend
// receives exactly what the user sees inside the generation frame. Several
// input slots go out as one condition set in canvas order.
// See flattenCanvas.ts and resize.ts for the compositing and resize pipeline.

import { useGenerationStore } from "@/stores/generationStore";
import type { GenerationState } from "@/stores/generationStore";
import { useScriptStore } from "@/stores/scriptStore";
import { useControlStore, resolveUnitImage } from "@/stores/controlStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useCanvasStore, type MaskObjectLayer } from "@/stores/canvasStore";
import { useUiStore } from "@/stores/uiStore";
import { exportMask } from "@/lib/exportMask";
import { flattenCanvas, compositeControlImage, compositeFitImage } from "@/lib/flattenCanvas";
import { uploadFiles, uploadBlob, uploadFile } from "@/lib/upload";
import { resizeBlob } from "@/lib/resize";
import { REFERENCE_HEIGHT } from "@/canvas/useControlFrameLayout";
import { sourceImageSize, wireSources, type WireSource } from "@/canvas/inputFrames";
import type { ControlRequest } from "@/api/types/generation";
import type { DetailerMode } from "@/api/types/models";
import { BACKEND_UNIT_TYPE } from "@/api/types/control";
import { generationParams } from "./generateParams";
import { planInputs, type PlanSlot } from "./inputPlan";

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

function planSlot(source: WireSource): PlanSlot {
  return {
    slot: source.slot,
    imageSize: sourceImageSize(source),
    hasMask:
      source.kind === "initial" &&
      (source.frame.maskLines.length > 0 || source.frame.layers.some((l) => l.type === "mask")),
  };
}

/** Several slots as one condition set, in slot order: Initial slots flattened and
 * resized to the output size here, references raw. Returns the first Initial
 * slot at frame size for the job snapshot. */
async function uploadConditionSet(
  sources: WireSource[],
  gen: GenerationState,
  target: { width: number; height: number },
): Promise<{ refs: string[]; snapshotImage: Blob | undefined }> {
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
  return { refs, snapshotImage };
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

  const request = generationParams(gen, {
    livePreviews: ui.livePreviews,
    sizeMultiple,
    requestSetsSize,
    strengthSupported,
    detailerMode,
    scripts,
  });

  // Control units: partition by type - IP-adapter vs control types
  const enabledIPUnits = control.units.filter(
    (u) => u.enabled && u.unitType === "ip" && u.images.length > 0,
  );

  // Resolve images for control units (may reference another unit's image via "unit:N")
  const controlUnitEntries = control.units
    .map((u, i) => ({ unit: u, image: resolveUnitImage(control.units, i) }))
    .filter((e) => e.unit.enabled && e.unit.unitType !== "ip" && e.image);

  // One entry per image the canvas numbers, in that order
  const sources = wireSources(canvas.inputFrames);
  const planned = planInputs({
    slots: sources.map(planSlot),
    frame: { width: gen.width, height: gen.height },
    sizeMode: img2img.sizeMode,
    autoFit: ui.autoFitFrame,
    scaleFactor: img2img.scaleFactor,
    megapixelTarget: img2img.megapixelTarget,
    sizeMultiple,
    maxInputImages,
    requestSetsSize,
    referenceSets,
    sendsControlUnits: controlUnitEntries.length > 0 || enabledIPUnits.length > 0,
    checkpointOverride: "sd_model_checkpoint" in gen.overrideSettings,
    batchCount: gen.batchCount,
    batchSize: gen.batchSize,
  });
  if (!planned.ok) throw new InputRefusal(planned.refusal);
  const { plan } = planned;

  if (enabledIPUnits.length > 0) {
    request.ip_adapter = await Promise.all(
      enabledIPUnits.map(async (u) => ({
        adapter: u.adapter,
        scale: u.scale,
        crop: u.crop,
        start: u.start,
        end: u.end,
        images: await uploadFiles(u.images),
        ...(u.masks.length > 0 ? { masks: await uploadFiles(u.masks) } : {}),
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
  if (plan.transport === "set") {
    const { refs, snapshotImage } = await uploadConditionSet(sources, gen, plan.target);
    request.inputs = refs;
    request.skip_processing = true;
    request.input_type = 1;
    request.width_before = plan.target.width;
    request.height_before = plan.target.height;
    request.batch_count = plan.batchCount;
    request.batch_size = 1;
    inputBlob = snapshotImage;
  } else if (plan.transport === "reference" && primary?.kind === "reference") {
    // The source file as it is
    request.inputs = [await uploadFile(primary.reference.file)];
    request.input_type = 1;
    request.width_before = plan.size.width;
    request.height_before = plan.size.height;
    inputBlob = primary.reference.file;
  } else if (plan.transport === "img2img" && primary?.kind === "initial") {
    // img2img: add inputs, mask, inpainting params
    const frameW = gen.width;
    const frameH = gen.height;
    request.width_before = plan.target.width;
    request.height_before = plan.target.height;
    request.input_type = 1;

    // Flatten the slot's image layers at full frame size.
    const flattenedBlob = await flattenCanvas(primary.layers, frameW, frameH);
    if (flattenedBlob) {
      inputBlob = flattenedBlob;
      const ref = await uploadBlob(flattenedBlob, "input.png");
      request.inputs = [ref];
    }

    // Force resize_mode_before=1 (Fixed) + resize_name_before so the backend
    // resizes the init image to the generation size.
    // Both fields are required: run.py zeros resize_mode when resize_name is 'None'.
    if (plan.serverResize) {
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
