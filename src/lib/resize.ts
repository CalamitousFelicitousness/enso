// WYSIWYG resize - high-quality image scaling for the canvas compositing pipeline.
//
// Canvas layers are composited at frame resolution, then resized to generation
// resolution here. This is part of the WYSIWYG guarantee: the resize quality
// must be high enough that the generated output matches what the user sees.
// The default, WASM Lanczos3, converts to linear light and premultiplies alpha
// in float inside the kernel, which avoids the aliasing, gamma darkening and
// dark fringes of browser-native Canvas 2D drawImage. MKS2021 stays selectable
// and works in sRGB: its WASM takes 8-bit input and ignores both options.

import resize from "@jsquash/resize";

export type ResizeMethod = "lanczos3" | "magicKernelSharp2021" | "mitchell" | "catrom" | "triangle";

const DEFAULT_METHOD: ResizeMethod = "lanczos3";

// iOS Safari caps canvas at ~16.7MP; other mobile browsers have similar limits.
// Leave headroom below the hard limit to account for multiple concurrent canvases.
const MAX_CANVAS_PIXELS = 16_000_000;

// ─── Capability detection ───────────────────────────────────────────────────
//
// On constrained devices (mobile, low-memory) we fall back from WASM
// to createImageBitmap with resizeQuality:"high" (browser-native bicubic).
// Still much better than the raw bilinear drawImage that was used before.

let _constrained: boolean | null = null;

function isConstrained(): boolean {
  if (_constrained !== null) return _constrained;
  const ua = navigator.userAgent;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  // navigator.deviceMemory is Chrome-only (GB), absent on Safari/Firefox
  const lowMemory =
    "deviceMemory" in navigator && (navigator as { deviceMemory: number }).deviceMemory < 4;
  _constrained = isMobile || lowMemory;
  return _constrained;
}

/** Check whether a canvas at w×h would exceed the platform's pixel limit. */
export function canvasFitsLimit(w: number, h: number): boolean {
  return w * h <= MAX_CANVAS_PIXELS;
}

/**
 * The size a source above `limit` pixels is first shrunk to natively: twice
 * the target on each side, or the largest size within the limit when that is
 * smaller. Null when the source fits the limit.
 */
export function stagedSize(
  source: { width: number; height: number },
  target: { width: number; height: number },
  limit: number = MAX_CANVAS_PIXELS,
): { width: number; height: number } | null {
  const pixels = source.width * source.height;
  if (pixels <= limit) return null;
  const twice = Math.max((2 * target.width) / source.width, (2 * target.height) / source.height);
  const scale = Math.min(1, twice, Math.sqrt(limit / pixels));
  return {
    width: Math.max(1, Math.floor(source.width * scale)),
    height: Math.max(1, Math.floor(source.height * scale)),
  };
}

// ─── Fast path: browser-native resize via createImageBitmap ─────────────────

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvasToBlob: toBlob returned null"));
    }, "image/png");
  });
}

async function nativeResize(
  canvas: HTMLCanvasElement,
  targetW: number,
  targetH: number,
): Promise<Blob> {
  const blob = await canvasToBlob(canvas);
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: targetW,
    resizeHeight: targetH,
    resizeQuality: "high",
  });
  const out = document.createElement("canvas");
  out.width = targetW;
  out.height = targetH;
  out.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvasToBlob(out);
}

// ─── WASM path: @jsquash/resize ─────────────────────────────────────────────

/** Resamples RGBA pixels with the WASM kernel, in linear light with
 * premultiplied alpha where the method supports it. */
export function resizePixels(
  source: ImageData,
  width: number,
  height: number,
  method: ResizeMethod = DEFAULT_METHOD,
): Promise<ImageData> {
  return resize(source, { width, height, method, linearRGB: true, premultiply: true });
}

function canvasToImageData(canvas: HTMLCanvasElement): ImageData {
  return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
}

function imageDataToBlob(imageData: ImageData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext("2d")!.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
}

async function wasmResize(
  canvas: HTMLCanvasElement,
  targetW: number,
  targetH: number,
  method: ResizeMethod,
): Promise<Blob> {
  return imageDataToBlob(await resizePixels(canvasToImageData(canvas), targetW, targetH, method));
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * High-quality resize of a canvas element to target dimensions.
 *
 * Desktop: WASM Lanczos3 in linear light with premultiplied alpha.
 * Mobile/constrained: createImageBitmap with resizeQuality:"high"
 * (browser-native bicubic - still far better than raw bilinear).
 *
 * Returns a PNG Blob at exactly targetW × targetH.
 * If the canvas is already at the target size, exports directly.
 */
export async function resizeCanvas(
  canvas: HTMLCanvasElement,
  targetW: number,
  targetH: number,
  method: ResizeMethod = DEFAULT_METHOD,
): Promise<Blob> {
  if (canvas.width === targetW && canvas.height === targetH) {
    return canvasToBlob(canvas);
  }
  if (isConstrained()) {
    return nativeResize(canvas, targetW, targetH);
  }
  return wasmResize(canvas, targetW, targetH, method);
}

/**
 * High-quality resize of a Blob (PNG/JPEG image) to target dimensions.
 * A source above the canvas limit is first shrunk natively (`stagedSize`), so
 * no full-size canvas is drawn; `sourceSize`, when the caller knows it, also
 * spares the full decode.
 */
export async function resizeBlob(
  blob: Blob,
  targetW: number,
  targetH: number,
  method: ResizeMethod = DEFAULT_METHOD,
  sourceSize?: { width: number; height: number },
): Promise<Blob> {
  const target = { width: targetW, height: targetH };
  const known = sourceSize ? stagedSize(sourceSize, target) : null;
  let bitmap = known
    ? await createImageBitmap(blob, {
        resizeWidth: known.width,
        resizeHeight: known.height,
        resizeQuality: "high",
      })
    : await createImageBitmap(blob);
  if (!known) {
    if (bitmap.width === targetW && bitmap.height === targetH) {
      bitmap.close();
      return blob;
    }
    const staged = stagedSize(bitmap, target);
    if (staged) {
      const whole = bitmap;
      bitmap = await createImageBitmap(whole, {
        resizeWidth: staged.width,
        resizeHeight: staged.height,
        resizeQuality: "high",
      });
      whole.close();
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return resizeCanvas(canvas, targetW, targetH, method);
}
