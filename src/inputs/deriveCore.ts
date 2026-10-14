// A picture redrawn at the size it is sent at: cropped for a cover fit,
// shrunk natively to within the canvas limit, then resampled with the resize
// kernel and encoded as PNG. Runs in the derivation worker, or on the main
// thread where workers are not available.

import type { Size } from "@/lib/inputs/types";
import type { Fit } from "@/lib/media/sizeRule";
import { resizePixels, stagedSize } from "@/lib/resize";

export interface DeriveInput {
  blob: Blob;
  /** The picture's size as this browser draws it. */
  size: Size;
  fit: Fit;
}

export interface Crop extends Size {
  x: number;
  y: number;
}

/** The part of a picture a fit draws: all of it, or for `cover` the centred
 * part with the fit's aspect. */
export function cropFor(size: Size, fit: Fit): Crop {
  if (fit.mode === "stretch") return { x: 0, y: 0, ...size };
  const aspect = fit.width / fit.height;
  if (size.width / size.height > aspect) {
    const width = Math.max(1, Math.round(size.height * aspect));
    return { x: Math.floor((size.width - width) / 2), y: 0, width, height: size.height };
  }
  const height = Math.max(1, Math.round(size.width / aspect));
  return { x: 0, y: Math.floor((size.height - height) / 2), width: size.width, height };
}

export async function derivePicture({ blob, size, fit }: DeriveInput): Promise<Blob> {
  const crop = cropFor(size, fit);
  const staged = stagedSize(crop, fit) ?? { width: crop.width, height: crop.height };
  const bitmap = await createImageBitmap(blob, crop.x, crop.y, crop.width, crop.height, {
    resizeWidth: staged.width,
    resizeHeight: staged.height,
    resizeQuality: "high",
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A picture could not be drawn to send");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  let pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  if (pixels.width !== fit.width || pixels.height !== fit.height) {
    pixels = await resizePixels(pixels, fit.width, fit.height);
  }
  const out = new OffscreenCanvas(fit.width, fit.height);
  const outContext = out.getContext("2d");
  if (!outContext) throw new Error("A picture could not be drawn to send");
  outContext.putImageData(pixels, 0, 0);
  return out.convertToBlob({ type: "image/png" });
}
