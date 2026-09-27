import type { WireSlot } from "@/canvas/inputFrames";

export type SizeMode = "fixed" | "scale" | "megapixel";

// Diffusion models require dimensions that are multiples of 8. Each dimension is
// rounded independently, which can shift aspect ratio by up to ~1.5%. This is
// inherent to the constraint and accepted as a WYSIWYG limitation.
export function snapTo8(value: number): number {
  return Math.round(value / 8) * 8;
}

export function computeScaledSize(
  frameW: number,
  frameH: number,
  scaleFactor: number,
): { width: number; height: number } {
  return {
    width: Math.max(64, snapTo8(frameW * scaleFactor)),
    height: Math.max(64, snapTo8(frameH * scaleFactor)),
  };
}

export function computeMegapixelSize(
  frameW: number,
  frameH: number,
  megapixelTarget: number,
): { width: number; height: number } {
  const targetPixels = megapixelTarget * 1_000_000;
  const currentPixels = frameW * frameH;
  if (currentPixels === 0) return { width: 512, height: 512 };
  const scale = Math.sqrt(targetPixels / currentPixels);
  return {
    width: Math.max(64, snapTo8(frameW * scale)),
    height: Math.max(64, snapTo8(frameH * scale)),
  };
}

export function resolveGenerationSize(
  sizeMode: SizeMode,
  frameW: number,
  frameH: number,
  scaleFactor: number,
  megapixelTarget: number,
): { width: number; height: number } {
  switch (sizeMode) {
    case "scale":
      return computeScaledSize(frameW, frameH, scaleFactor);
    case "megapixel":
      return computeMegapixelSize(frameW, frameH, megapixelTarget);
    default:
      return { width: frameW, height: frameH };
  }
}

/** A lone Reference on a local model goes out as-is, and the server sizes the
 * output from the image itself. */
export function serverSizesFromImage(slots: readonly WireSlot[], local: boolean): boolean {
  return local && slots.length === 1 && slots[0].mode === "reference";
}

/** Scale and Megapixel apply while Fit sizes the frame from an input image
 * and the request carries that size; otherwise the frame size is sent as is. */
export function sizeModesApply(fit: boolean, slots: readonly WireSlot[], local: boolean): boolean {
  return fit && slots.length > 0 && !serverSizesFromImage(slots, local);
}

export function effectiveSizeMode(
  sizeMode: SizeMode,
  fit: boolean,
  slots: readonly WireSlot[],
  local: boolean,
): SizeMode {
  return sizeModesApply(fit, slots, local) ? sizeMode : "fixed";
}

/** Compute final output size after hires fix (if enabled). */
export function resolveOutputSize(
  base: { width: number; height: number },
  hiresEnabled: boolean,
  hiresScale: number,
  hiresResizeX: number,
  hiresResizeY: number,
): { width: number; height: number } {
  if (!hiresEnabled) return base;
  // Fixed dims: use explicit target
  if (hiresResizeX > 0 || hiresResizeY > 0) {
    return {
      width: hiresResizeX || base.width,
      height: hiresResizeY || base.height,
    };
  }
  // Scale mode
  if (hiresScale > 1) {
    return {
      width: Math.max(64, snapTo8(base.width * hiresScale)),
      height: Math.max(64, snapTo8(base.height * hiresScale)),
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
