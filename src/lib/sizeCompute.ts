import type { WireSlot } from "@/canvas/inputFrames";

export type SizeMode = "fixed" | "scale" | "megapixel";

/** Size step until the loaded model reports its own. */
export const DEFAULT_SIZE_MULTIPLE = 8;

// The server keeps a size on the model's multiple and rounds any other, so each
// dimension snaps to it independently, which can shift the aspect ratio slightly.
export function snapSize(value: number, multiple: number): number {
  return Math.max(Math.ceil(64 / multiple) * multiple, Math.round(value / multiple) * multiple);
}

export function computeScaledSize(
  frameW: number,
  frameH: number,
  scaleFactor: number,
  multiple: number,
): { width: number; height: number } {
  return {
    width: snapSize(frameW * scaleFactor, multiple),
    height: snapSize(frameH * scaleFactor, multiple),
  };
}

export function computeMegapixelSize(
  frameW: number,
  frameH: number,
  megapixelTarget: number,
  multiple: number,
): { width: number; height: number } {
  const targetPixels = megapixelTarget * 1_000_000;
  const currentPixels = frameW * frameH;
  if (currentPixels === 0) return { width: 512, height: 512 };
  const scale = Math.sqrt(targetPixels / currentPixels);
  return {
    width: snapSize(frameW * scale, multiple),
    height: snapSize(frameH * scale, multiple),
  };
}

export function resolveGenerationSize(
  sizeMode: SizeMode,
  frameW: number,
  frameH: number,
  scaleFactor: number,
  megapixelTarget: number,
  multiple: number,
): { width: number; height: number } {
  switch (sizeMode) {
    case "scale":
      return computeScaledSize(frameW, frameH, scaleFactor, multiple);
    case "megapixel":
      return computeMegapixelSize(frameW, frameH, megapixelTarget, multiple);
    default:
      return { width: snapSize(frameW, multiple), height: snapSize(frameH, multiple) };
  }
}

/** A local model generates a lone Reference at the image's size unless the
 * request sets its output size, as it does for a cloud model. Unknown (the
 * selected model is not loaded) counts as the image's size. */
export function referenceSetsSize(local: boolean, requestSetsSize: boolean | null): boolean {
  return local && requestSetsSize !== true;
}

/** The output takes the size of the lone Reference sent. */
export function serverSizesFromImage(slots: readonly WireSlot[], referenceSets: boolean): boolean {
  return referenceSets && slots.length === 1 && slots[0].mode === "reference";
}

/** Output size the server makes from an image it sizes from: each side
 * rounded up to the multiple. */
export function imageOutputSize(
  image: { width: number; height: number },
  multiple: number,
): { width: number; height: number } {
  const up = (value: number) => Math.ceil(value / multiple) * multiple;
  return { width: up(image.width), height: up(image.height) };
}

/** Scale and Megapixel apply while Fit sizes the frame from an input image
 * and the request carries that size; otherwise the frame size is sent as is. */
export function sizeModesApply(
  fit: boolean,
  slots: readonly WireSlot[],
  referenceSets: boolean,
): boolean {
  return fit && slots.length > 0 && !serverSizesFromImage(slots, referenceSets);
}

export function effectiveSizeMode(
  sizeMode: SizeMode,
  fit: boolean,
  slots: readonly WireSlot[],
  referenceSets: boolean,
): SizeMode {
  return sizeModesApply(fit, slots, referenceSets) ? sizeMode : "fixed";
}

/** Final output size after hires fix, rounded down to the size multiple as the server does. */
export function resolveOutputSize(
  base: { width: number; height: number },
  hiresEnabled: boolean,
  hiresScale: number,
  hiresResizeX: number,
  hiresResizeY: number,
  multiple: number,
): { width: number; height: number } {
  if (!hiresEnabled) return base;
  const floor = (value: number) => Math.floor(value / multiple) * multiple;
  // Fixed dims: use explicit target
  if (hiresResizeX > 0 || hiresResizeY > 0) {
    return {
      width: floor(hiresResizeX || base.width),
      height: floor(hiresResizeY || base.height),
    };
  }
  // Scale mode
  if (hiresScale > 1) {
    return {
      width: floor(base.width * hiresScale),
      height: floor(base.height * hiresScale),
    };
  }
  return base;
}

export function containFit(
  w: number,
  h: number,
  boxW: number,
  boxH: number,
): { width: number; height: number } {
  if (w === 0 || h === 0) return { width: boxW, height: boxH };
  const scale = Math.min(boxW / w, boxH / h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export function formatMegapixels(w: number, h: number): string {
  const mp = (w * h) / 1_000_000;
  return `~${mp.toFixed(1)} MP`;
}
