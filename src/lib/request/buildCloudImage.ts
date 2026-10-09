import { useGenerationStore } from "@/stores/generationStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useInputStore } from "@/stores/inputStore";
import { useUiStore } from "@/stores/uiStore";
import { outlineWithMaps } from "@/inputs/maps";
import { createUploader, type Ledger } from "@/inputs/materialise";
import { computeOutline } from "@/lib/inputs/outline";
import type { Inputs } from "@/lib/inputs/stored";
import { problemText, unreadableText } from "@/lib/inputs/text";
import type { Size } from "@/lib/inputs/types";
import type { ProcessorFacts } from "@/lib/processorUtils";
import { DEFAULT_SIZE_MULTIPLE, effectiveSizeMode, resolveGenerationSize } from "@/lib/sizeCompute";
import type { CloudImageJobParams, CloudModel } from "@/api/types/cloud";

export interface CloudBuildResult {
  request: CloudImageJobParams;
  /** The frames the request was built from. */
  inputs: Inputs;
  /** Where each upload the request names came from. */
  ledger: Ledger;
}

export async function buildCloudImageRequest(
  processors: ProcessorFacts,
): Promise<CloudBuildResult> {
  const { activeModel } = useModelSelectionStore.getState();
  const gen = useGenerationStore.getState();
  const { frames, sizeSource } = useInputStore.getState();
  const img2img = useImg2ImgStore.getState();
  const model = activeModel as CloudModel;

  const frame: Size = { width: gen.width, height: gen.height };

  // One image per sent picture, in the order sent. An Initial frame gives one
  // composite encoded for the provider; a reference uploads raw (no provider
  // encoding); a processed picture goes as its map. The first Initial frame
  // determines strength + mask. Mixed Initial+Reference works: paint Image 1,
  // point at Image 2 as reference.
  const base = computeOutline(frames);
  const unreadable = unreadableText(base.entries);
  if (unreadable) throw new Error(unreadable);

  // The size rule the canvas layout shows
  const fit = useUiStore.getState().autoFitFrame;
  const targetSize = resolveGenerationSize(
    effectiveSizeMode(img2img.sizeMode, fit, base.sent, false),
    frame.width,
    frame.height,
    img2img.scaleFactor,
    img2img.megapixelTarget,
    DEFAULT_SIZE_MULTIPLE,
  );

  // The provider cannot process: every map must be current, once the cache has answered
  const outline = await outlineWithMaps(frames, processors, {
    cloud: true,
    controlUnified: false,
    frame,
    target: targetSize,
  });
  const stale = outline.entries
    .filter((e) => e.sent.some((s) => s.map && s.map.state !== "current"))
    .map((e) => e.position);
  if (stale.length > 0) throw new Error(problemText({ code: "cloudMaps", positions: stale }));
  const { sent } = outline;

  // The first Initial frame carries strength and the mask; reference-only
  // generations have no strength surface.
  const firstInitial = sent.find((s) => s.role === "initial") ?? null;

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

  const up = createUploader({ frames, size: frame });
  const inputs: Inputs = { frames, size: frame, sizeSource };
  const encoding = { provider: model.provider, model: model.id };
  // The primary Initial frame's encoded dimensions, for the mask
  let primaryEncoded: Size | null = null;
  const imageRefs: string[] = [];

  for (const source of sent) {
    const map = source.map?.state === "current" ? source.map : null;
    if (source.role === "reference") {
      // Raw upload, no encoding - sdnext's adapter dispatches per-provider
      imageRefs.push(
        map ? (await up.map(map.key)).ref : await up.file(source.frameId, source.pictureId ?? ""),
      );
      continue;
    }
    // This Initial frame's pictures, or their map, at the target size and
    // encoded for the provider
    const upload = map
      ? await up.map(map.key, targetSize, encoding)
      : await up.composite(source.frameId, targetSize, encoding);
    imageRefs.push(upload.ref);
    if (source === firstInitial) {
      primaryEncoded = upload.size;
      // The provider's input limits can clip the aspect or the longest side;
      // the size sent follows unless the caller asked for size="auto"
      if (
        !autoEnabled &&
        (upload.size.width !== targetSize.width || upload.size.height !== targetSize.height)
      ) {
        request.size = `${upload.size.width}x${upload.size.height}`;
      }
    }
  }

  if (imageRefs.length === 0) {
    // No input images - pure txt2img. Return without setting image/images.
    return { request, inputs, ledger: up.ledger };
  }

  request.images = imageRefs;

  if (firstInitial) {
    // Strength + mask apply when an Initial frame contributes; the mask is
    // the first Initial frame's, at the size its picture went out at.
    request.strength = gen.denoisingStrength;
    const mask = await up.mask(firstInitial.frameId, primaryEncoded ?? targetSize);
    if (mask) request.mask = mask;
  }

  return { request, inputs, ledger: up.ledger };
}
