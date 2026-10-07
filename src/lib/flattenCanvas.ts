// WYSIWYG canvas compositing - what the user sees in the frame is what gets sent.
//
// The backend receives a single flattened image. It has no concept of canvas layers,
// transforms, or viewport. All compositing happens here on the client.
//
// IMPORTANT: The layer transform math here (translate, rotate, scale per layer) must
// match the display rendering in FrameLayer.tsx (Konva scene graph). Both codepaths
// independently implement the same transforms. Changes to one must update the other.

import type { PlacedPicture, Size } from "@/lib/inputs/types";
import { resizeBlob, canvasFitsLimit } from "@/lib/resize";

// A layer whose drawn size differs from its file by more than this share is
// resampled to its drawn size with MKS2021 first, so Canvas 2D never scales
// it by more than this.
const RESAMPLE_ABOVE = 0.01;

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode the composite"));
    }, "image/png");
  });
}

/**
 * Composites the given pictures, bottom to top, within the frame bounds into a
 * single PNG Blob. Null when there is none; throws when one has no bytes.
 *
 * Transforms are in frame pixels. With `target`, the composition is drawn at
 * that size instead, each axis stretched by target/frame. A layer drawn at
 * another size than its file is resampled to its drawn size with MKS2021 and
 * then blitted 1:1, at whole pixels when it is not rotated, so neither
 * downscaling nor upscaling goes through Canvas 2D's filter.
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
    const preResize =
      resampled &&
      preW >= 1 &&
      preH >= 1 &&
      canvasFitsLimit(layer.width, layer.height) &&
      canvasFitsLimit(preW, preH);
    const bitmap = await createImageBitmap(
      preResize ? await resizeBlob(files[i], preW, preH) : files[i],
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
      // The resampled bitmap covers the layer's drawn size in frame pixels
      const scaleX = preResize ? (transform.scaleX * layer.width) / preW : transform.scaleX;
      const scaleY = preResize ? (transform.scaleY * layer.height) / preH : transform.scaleY;
      ctx.scale(scaleX, scaleY);
      ctx.drawImage(bitmap, 0, 0);
    }
    ctx.restore();
    bitmap.close();
  }

  return canvasToPng(canvas);
}
