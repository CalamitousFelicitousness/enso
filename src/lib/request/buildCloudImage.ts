import { useGenerationStore } from "@/stores/generationStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useCanvasStore, type MaskObjectLayer } from "@/stores/canvasStore";
import { useUiStore } from "@/stores/uiStore";
import { exportMask } from "@/lib/exportMask";
import { flattenCanvas } from "@/lib/flattenCanvas";
import { uploadBlob, uploadFile } from "@/lib/upload";
import { resizeBlob } from "@/lib/resize";
import { getInputLimits } from "@/lib/cloudLimits";
import { optimizeImageForProvider } from "@/lib/imageOptimize";
import { wireSources } from "@/canvas/inputFrames";
import { DEFAULT_SIZE_MULTIPLE, effectiveSizeMode, resolveGenerationSize } from "@/lib/sizeCompute";
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
