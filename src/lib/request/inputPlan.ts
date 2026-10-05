import type { WireSlot } from "@/canvas/inputFrames";
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

/** One image the canvas numbers, as far as the transport decision needs it. */
export interface PlanSlot {
  slot: WireSlot;
  /** Natural size of the reference, or of an Initial slot's first visible layer. */
  imageSize: Size;
  /** The slot's frame carries mask strokes or mask layers. */
  hasMask: boolean;
}

export interface InputPlanContext {
  /** In the order the canvas numbers them. */
  slots: PlanSlot[];
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
  const { slots, maxInputImages } = ctx;
  const reasons: string[] = [];
  if (maxInputImages != null && slots.length > maxInputImages) {
    const takes = maxInputImages === 1 ? "one input image" : `up to ${maxInputImages} input images`;
    reasons.push(`The loaded model takes ${takes}; the canvas holds ${slots.length}`);
  }
  const settings: [string, boolean][] = [
    ["mask", slots.some((s) => s.hasMask)],
    ["control units", ctx.sendsControlUnits],
    ["checkpoint override", ctx.checkpointOverride],
  ];
  const conflicts = settings.filter(([, on]) => on).map(([label]) => label);
  if (conflicts.length > 0) {
    const inputs = slots.length > 1 ? "several input images" : "a Reference image";
    reasons.push(`Not available with ${inputs}: ${conflicts.join(", ")}`);
  }
  return reasons;
}

/** Decide how the canvas inputs travel. Several slots go out as one condition
 * set, and so does a lone Reference on a pipeline whose output size the request
 * sets; a single slot otherwise keeps the img2img or raw-reference path. */
export function planInputs(ctx: InputPlanContext): InputPlanResult {
  const { slots, frame, sizeMultiple, referenceSets } = ctx;
  if (slots.length === 0) return { ok: true, plan: { transport: "none" } };

  const wireSlots = slots.map((s) => s.slot);
  const primary = slots[0];
  const loneReference = slots.length === 1 && primary.slot.mode === "reference";
  const asSet = slots.length > 1 || (loneReference && ctx.requestSetsSize === true);
  // The frame showed the lone Reference's own size, so that size is sent
  const shownFromImage = serverSizesFromImage(wireSlots, referenceSets);
  const generationSize = (sized: WireSlot[]) =>
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
    const target = shownFromImage
      ? imageOutputSize(primary.imageSize, sizeMultiple)
      : generationSize(wireSlots);
    // QwenImageEditPlusPipeline refuses batch_size above 1
    return {
      ok: true,
      plan: { transport: "set", target, batchCount: ctx.batchCount * ctx.batchSize },
    };
  }

  if (primary.slot.mode === "reference") {
    // A model that takes one input image generates at the image's size, rounded
    // up to its multiple.
    const size = imageOutputSize(primary.imageSize, sizeMultiple);
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

  const target = generationSize([primary.slot]);
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
