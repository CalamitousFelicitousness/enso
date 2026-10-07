// WYSIWYG canvas compositing - what the user sees in the frame is what gets sent.
//
// The backend receives a single flattened image. It has no concept of canvas layers,
// transforms, or viewport. All compositing happens here on the client.
//
// IMPORTANT: The layer transform math here (translate, rotate, scale per layer) must
// match the display rendering in FrameLayer.tsx (Konva scene graph). Both codepaths
// independently implement the same transforms. Changes to one must update the other.

import type { PlacedPicture, Size } from "@/lib/inputs/types";
import type { FreeTransform, FitMode } from "@/lib/image";
import { computeFit } from "@/lib/image";
import { resizeBlob, resizeCanvas, canvasFitsLimit } from "@/lib/resize";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

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

/**
 * Composites an image onto a generation-sized canvas using the given fit mode.
 *
 * When the source image fits in a canvas (desktop), it is pre-resized via WASM
 * MKS2021 so Canvas 2D only does a 1:1 blit. On constrained devices where the
 * source is too large for an intermediate canvas, falls back to Canvas 2D with
 * imageSmoothingQuality:"high" (browser-native bicubic).
 */
export async function compositeFitImage(
  file: File,
  genW: number,
  genH: number,
  fitMode: FitMode,
): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  URL.revokeObjectURL(url);

  const fit = computeFit(img.naturalWidth, img.naturalHeight, 0, 0, genW, genH, fitMode);
  const srcW = fit.crop ? Math.round(fit.crop.width) : img.naturalWidth;
  const srcH = fit.crop ? Math.round(fit.crop.height) : img.naturalHeight;

  // If the source image fits within the canvas pixel limit, use the WASM path:
  // extract source region at native resolution, resize via MKS2021, 1:1 blit.
  if (canvasFitsLimit(srcW, srcH)) {
    const srcCanvas = document.createElement("canvas");
    if (fit.crop) {
      srcCanvas.width = srcW;
      srcCanvas.height = srcH;
      srcCanvas.getContext("2d")!.drawImage(img, -fit.crop.x, -fit.crop.y);
    } else {
      srcCanvas.width = srcW;
      srcCanvas.height = srcH;
      srcCanvas.getContext("2d")!.drawImage(img, 0, 0);
    }

    const drawW = Math.round(fit.width);
    const drawH = Math.round(fit.height);
    const resizedBlob = await resizeCanvas(srcCanvas, drawW, drawH);
    const resizedBitmap = await createImageBitmap(resizedBlob);

    const outCanvas = document.createElement("canvas");
    outCanvas.width = genW;
    outCanvas.height = genH;
    outCanvas.getContext("2d")!.drawImage(resizedBitmap, Math.round(fit.x), Math.round(fit.y));
    resizedBitmap.close();

    return new Promise<Blob>((resolve, reject) => {
      outCanvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to composite fit image"));
      }, "image/png");
    });
  }

  // Fallback: let Canvas 2D handle the downscale with its best interpolation
  const canvas = document.createElement("canvas");
  canvas.width = genW;
  canvas.height = genH;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  if (fit.crop) {
    ctx.drawImage(
      img,
      fit.crop.x,
      fit.crop.y,
      fit.crop.width,
      fit.crop.height,
      fit.x,
      fit.y,
      fit.width,
      fit.height,
    );
  } else {
    ctx.drawImage(img, fit.x, fit.y, fit.width, fit.height);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to composite fit image"));
    }, "image/png");
  });
}

/**
 * Composites a free-mode control image onto a generation-sized canvas.
 * The transform is in display-unit space; displayScale converts to pixel space.
 *
 * When the image is being downscaled and the source fits within the canvas
 * pixel limit, it is pre-resized via WASM MKS2021 so Canvas 2D only handles
 * rotation/positioning at near-1:1 scale. Falls back to Canvas 2D with
 * imageSmoothingQuality:"high" on constrained devices.
 */
export async function compositeControlImage(
  file: File,
  transform: FreeTransform,
  genW: number,
  genH: number,
  displayScale: number,
): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  URL.revokeObjectURL(url);

  // Convert display-unit transform to pixel space
  const pixelX = transform.x / displayScale;
  const pixelY = transform.y / displayScale;
  const pixelScaleX = transform.scaleX / displayScale;
  const pixelScaleY = transform.scaleY / displayScale;

  // Compute the drawn pixel dimensions
  const drawnW = Math.abs(img.naturalWidth * pixelScaleX);
  const drawnH = Math.abs(img.naturalHeight * pixelScaleY);

  const canvas = document.createElement("canvas");
  canvas.width = genW;
  canvas.height = genH;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";

  // Use WASM pre-resize when downscaling significantly and source fits in a canvas
  const isDownscaling =
    drawnW > 0 &&
    drawnH > 0 &&
    (drawnW < img.naturalWidth * 0.9 || drawnH < img.naturalHeight * 0.9);
  const canPreResize = isDownscaling && canvasFitsLimit(img.naturalWidth, img.naturalHeight);

  if (canPreResize) {
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = img.naturalWidth;
    srcCanvas.height = img.naturalHeight;
    srcCanvas.getContext("2d")!.drawImage(img, 0, 0);
    const resizedBlob = await resizeCanvas(srcCanvas, Math.round(drawnW), Math.round(drawnH));
    const resizedBitmap = await createImageBitmap(resizedBlob);

    const flipX = Math.sign(pixelScaleX) || 1;
    const flipY = Math.sign(pixelScaleY) || 1;
    ctx.save();
    ctx.translate(pixelX, pixelY);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.scale(flipX, flipY);
    ctx.drawImage(resizedBitmap, 0, 0);
    ctx.restore();
    resizedBitmap.close();
  } else {
    ctx.save();
    ctx.translate(pixelX, pixelY);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.scale(pixelScaleX, pixelScaleY);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to composite control image"));
    }, "image/png");
  });
}
