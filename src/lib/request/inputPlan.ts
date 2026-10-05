import type { SentInput } from "@/lib/inputs/outline";
import {
  effectiveSizeMode,
  imageOutputSize,
  resolveGenerationSize,
  serverSizesFromImage,
  type SizeMode,
} from "@/lib/sizeCompute";

interface Size {
  width: number;
  height: number;
}

export interface InputPlanContext {
  /** What the frames send, in the order the model receives it. */
  sent: SentInput[];
  /** The frame: Width and Height as set. */
  frame: Size;
  sizeMode: SizeMode;
  autoFit: boolean;
  scaleFactor: number;
  megapixelTarget: number;
  /** Width and height multiple the loaded model keeps a size at. */
  sizeMultiple: number;
  /** Most input images the loaded model takes in one request; null when unknown. */
  maxInputImages: number | null;
  /** The request sets the loaded pipeline's output size, also from one input image. */
  requestSetsSize: boolean | null;
  /** The canvas showed a lone Reference at the image's size. */
  referenceSets: boolean;
  sendsControlUnits: boolean;
  checkpointOverride: boolean;
  batchCount: number;
  batchSize: number;
}

/** How the canvas inputs travel in a generate job. */
export type InputPlan =
  | { transport: "none" }
  /** Every slot as one condition set at `target`, unprocessed by the server. */
  | { transport: "set"; target: Size; batchCount: number }
  /** One source file as it is; the model generates at `size`. */
  | { transport: "reference"; size: Size }
  /** One flattened frame; the server resizes it to `target` when `serverResize`. */
  | { transport: "img2img"; target: Size; serverResize: boolean };

export type InputPlanResult = { ok: true; plan: InputPlan } | { ok: false; refusal: string };

/** Why the inputs cannot go out as one set: the model's limit, and settings the
 * server applies only to a processed input. */
function setRefusals(ctx: InputPlanContext): string[] {
  const { sent, maxInputImages } = ctx;
  const reasons: string[] = [];
  if (maxInputImages != null && sent.length > maxInputImages) {
    const takes = maxInputImages === 1 ? "one input image" : `up to ${maxInputImages} input images`;
    reasons.push(`The loaded model takes ${takes}; the canvas holds ${sent.length}`);
  }
  const settings: [string, boolean][] = [
    ["mask", sent.some((s) => s.masked)],
    ["control units", ctx.sendsControlUnits],
    ["checkpoint override", ctx.checkpointOverride],
  ];
  const conflicts = settings.filter(([, on]) => on).map(([label]) => label);
  if (conflicts.length > 0) {
    const inputs = sent.length > 1 ? "several input images" : "a Reference image";
    reasons.push(`Not available with ${inputs}: ${conflicts.join(", ")}`);
  }
  return reasons;
}

/** Decide how the canvas inputs travel. Several pictures go out as one condition
 * set, and so does a lone Reference on a pipeline whose output size the request
 * sets; a single picture otherwise keeps the img2img or raw-reference path. */
export function planInputs(ctx: InputPlanContext): InputPlanResult {
  const { sent, frame, sizeMultiple, referenceSets } = ctx;
  if (sent.length === 0) return { ok: true, plan: { transport: "none" } };

  const primary = sent[0];
  const loneReference = sent.length === 1 && primary.role === "reference";
  const asSet = sent.length > 1 || (loneReference && ctx.requestSetsSize === true);
  // The frame showed the lone Reference's own size, so that size is sent
  const shownFromImage = serverSizesFromImage(sent, referenceSets);
  const generationSize = (sized: SentInput[]) =>
    resolveGenerationSize(
      effectiveSizeMode(ctx.sizeMode, ctx.autoFit, sized, referenceSets),
      frame.width,
      frame.height,
      ctx.scaleFactor,
      ctx.megapixelTarget,
      sizeMultiple,
    );

  if (asSet) {
    const reasons = setRefusals(ctx);
    if (reasons.length > 0) return { ok: false, refusal: `${reasons.join(". ")}.` };
    // The size rule the canvas layout shows, so the size on screen is the size sent
    const target = shownFromImage ? imageOutputSize(primary, sizeMultiple) : generationSize(sent);
    // QwenImageEditPlusPipeline refuses batch_size above 1
    return {
      ok: true,
      plan: { transport: "set", target, batchCount: ctx.batchCount * ctx.batchSize },
    };
  }

  if (primary.role === "reference") {
    // A model that takes one input image generates at the image's size, rounded
    // up to its multiple.
    const size = imageOutputSize(primary, sizeMultiple);
    // The canvas showed the Size set, going by what this model reported when it
    // was last loaded; it now reports otherwise.
    if (!shownFromImage) {
      return {
        ok: false,
        refusal: `The loaded model generates at the size of its input image, ${size.width}×${size.height}, and Size now shows that. Generate again to use it.`,
      };
    }
    return { ok: true, plan: { transport: "reference", size } };
  }

  const target = generationSize([primary]);
  return {
    ok: true,
    plan: {
      transport: "img2img",
      target,
      // Scale, megapixel or a coarser size multiple: the server resizes the init image
      serverResize: target.width !== frame.width || target.height !== frame.height,
    },
  };
}
