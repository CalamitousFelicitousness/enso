// WYSIWYG canvas compositing - what the user sees in the frame is what gets sent.
//
// The backend receives a single flattened image. It has no concept of canvas layers,
// transforms, or viewport. All compositing happens here on the client.
//
// IMPORTANT: The layer transform math here (translate, rotate, scale per layer) must
// match the display rendering in FrameLayer.tsx (Konva scene graph). Both codepaths
// independently implement the same transforms. Changes to one must update the other.

import type { PlacedPicture, Size } from "@/lib/inputs/types";
import { CANVAS_CEILING_PIXELS } from "@/lib/media/limits";
import { canvasTooLargeText } from "@/lib/media/text";
import { InputRefusal } from "@/lib/request/refusal";
import { resizeBlob, canvasFitsLimit, stagedSize } from "@/lib/resize";

// A layer whose drawn size differs from its file by more than this share is
// resampled to its drawn size with the WASM kernel first, so Canvas 2D never
// scales it by more than this.
const RESAMPLE_ABOVE = 0.01;

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode the composite"));
    }, "image/png");
  });
}

/** The layer's bitmap: resampled to its drawn size when `drawn` is given,
 * else its file, shrunk natively first when it is above the canvas limit. */
async function layerBitmap(file: Blob, natural: Size, drawn: Size | null): Promise<ImageBitmap> {
  if (drawn)
    return createImageBitmap(await resizeBlob(file, drawn.width, drawn.height, undefined, natural));
  const staged = stagedSize(natural, natural);
  return staged
    ? createImageBitmap(file, {
        resizeWidth: staged.width,
        resizeHeight: staged.height,
        resizeQuality: "high",
      })
    : createImageBitmap(file);
}

/**
 * Composites the given pictures, bottom to top, within the frame bounds into a
 * single PNG Blob. Null when there is none; throws when one has no bytes, and
 * refuses (`InputRefusal`) an output larger than the browser can draw.
 *
 * Transforms are in frame pixels. With `target`, the composition is drawn at
 * that size instead, each axis stretched by target/frame. A layer drawn at
 * another size than its file is resampled to its drawn size with the WASM
 * kernel and then blitted 1:1, at whole pixels when it is not rotated, so
 * neither downscaling nor upscaling goes through Canvas 2D's filter.
 */
export async function flattenCanvas(
  layers: PlacedPicture[],
  frameWidth: number,
  frameHeight: number,
  target: Size = { width: frameWidth, height: frameHeight },
): Promise<Blob | null> {
  const visible = layers.filter((l) => l.visible);
  if (visible.length === 0) return null;
  const files: Blob[] = [];
  for (const { file } of visible) {
    if (!file) throw new Error("A layer's picture could not be read");
    files.push(file);
  }
  if (target.width * target.height > CANVAS_CEILING_PIXELS) {
    throw new InputRefusal(canvasTooLargeText(target, CANVAS_CEILING_PIXELS));
  }

  const kx = target.width / frameWidth;
  const ky = target.height / frameHeight;

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";

  for (const [i, layer] of visible.entries()) {
    const { transform } = layer;
    const drawnW = Math.abs(transform.scaleX) * layer.width * kx;
    const drawnH = Math.abs(transform.scaleY) * layer.height * ky;
    const preW = Math.round(drawnW);
    const preH = Math.round(drawnH);
    const resampled =
      Math.abs(drawnW / layer.width - 1) > RESAMPLE_ABOVE ||
      Math.abs(drawnH / layer.height - 1) > RESAMPLE_ABOVE;
    const preResize = resampled && preW >= 1 && preH >= 1 && canvasFitsLimit(preW, preH);
    const natural = { width: layer.width, height: layer.height };
    const bitmap = await layerBitmap(
      files[i],
      natural,
      preResize ? { width: preW, height: preH } : null,
    );
    const flipX = Math.sign(transform.scaleX) || 1;
    const flipY = Math.sign(transform.scaleY) || 1;

    ctx.save();
    ctx.globalAlpha = layer.opacity;
    if (preResize && transform.rotation === 0) {
      // Already at its drawn size: blit it whole at the nearest pixel
      ctx.setTransform(
        flipX,
        0,
        0,
        flipY,
        Math.round(transform.x * kx),
        Math.round(transform.y * ky),
      );
      ctx.drawImage(bitmap, 0, 0);
    } else {
      ctx.setTransform(kx, 0, 0, ky, 0, 0);
      ctx.translate(transform.x, transform.y);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      // The bitmap covers the layer's natural size in frame pixels, whatever size it was decoded at
      ctx.scale(
        (transform.scaleX * layer.width) / bitmap.width,
        (transform.scaleY * layer.height) / bitmap.height,
      );
      ctx.drawImage(bitmap, 0, 0);
    }
    ctx.restore();
    bitmap.close();
  }

  return canvasToPng(canvas);
}
