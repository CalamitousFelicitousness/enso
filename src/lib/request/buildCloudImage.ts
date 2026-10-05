import { useGenerationStore } from "@/stores/generationStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useInputStore } from "@/stores/inputStore";
import { useUiStore } from "@/stores/uiStore";
import { exportMask } from "@/lib/exportMask";
import { flattenCanvas } from "@/lib/flattenCanvas";
import { uploadBlob } from "@/lib/upload";
import { resizeBlob } from "@/lib/resize";
import { getInputLimits } from "@/lib/cloudLimits";
import { optimizeImageForProvider } from "@/lib/imageOptimize";
import { computeOutline } from "@/lib/inputs/outline";
import { unreadableText } from "@/lib/inputs/text";
import { composedPictures } from "@/lib/inputs/types";
import { DEFAULT_SIZE_MULTIPLE, effectiveSizeMode, resolveGenerationSize } from "@/lib/sizeCompute";
import type { CloudImageJobParams, CloudModel } from "@/api/types/cloud";

export async function buildCloudImageRequest(): Promise<CloudImageJobParams> {
  const { activeModel } = useModelSelectionStore.getState();
  const gen = useGenerationStore.getState();
  const { frames } = useInputStore.getState();
  const img2img = useImg2ImgStore.getState();
  const model = activeModel as CloudModel;

  const frameW = gen.width;
  const frameH = gen.height;

  // One image per sent picture, in the order sent. An Initial frame gives one
  // flattened+optimized blob; a reference uploads raw (no flatten, no provider
  // optimization). The first Initial frame determines strength + mask. Mixed
  // Initial+Reference works: paint Image 1, point at Image 2 as reference.
  const outline = computeOutline(frames);
  const unreadable = unreadableText(outline.entries);
  if (unreadable) throw new Error(unreadable);
  const { sent } = outline;
  const frameOf = (frameId: string) => frames.find((f) => f.id === frameId);

  // The first Initial frame carries strength and the mask; reference-only
  // generations have no strength surface.
  const firstInitial = sent.find((s) => s.role === "initial") ?? null;

  // The size rule the canvas layout shows
  const fit = useUiStore.getState().autoFitFrame;
  const targetSize = resolveGenerationSize(
    effectiveSizeMode(img2img.sizeMode, fit, sent, false),
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

  for (const source of sent) {
    const frame = frameOf(source.frameId);
    if (!frame) continue;
    if (source.role === "reference") {
      // Raw upload, no optimization - sdnext's adapter dispatches per-provider.
      const picture = frame.pictures.find((p) => p.id === source.pictureId);
      if (picture?.file) imageRefs.push(await uploadBlob(picture.file, picture.name));
      continue;
    }
    // Flatten + optimize + upload this Initial frame's pictures.
    let imageBlob = await flattenCanvas(composedPictures(frame), frameW, frameH);
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

  const maskFrame = firstInitial && frameOf(firstInitial.frameId);
  if (maskFrame) {
    // Strength + mask apply when an Initial frame contributes; the mask is
    // the first Initial frame's.
    request.strength = gen.denoisingStrength;
    const { strokes, objects } = maskFrame.mask;
    if (strokes.length > 0 || objects.length > 0) {
      let maskBlob = await exportMask(objects, strokes, frameW, frameH);
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
