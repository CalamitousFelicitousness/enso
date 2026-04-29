import type { InputLimits, ImageFormat } from "@/api/types/cloud";
import { resizeBlob } from "@/lib/resize";

export interface OptimizeResult {
  blob: Blob;
  format: ImageFormat;
  quality: number | null;
  dimensions: { width: number; height: number };
  warnings: string[];
}

export class InputTooLargeError extends Error {
  readonly imageBytes: number;
  readonly limit: number;
  readonly providerLabel: string;

  constructor(imageBytes: number, limit: number, providerLabel: string) {
    const sizeMB = (imageBytes / 1_000_000).toFixed(1);
    const limitMB = (limit / 1_000_000).toFixed(1);
    super(
      `Image ${sizeMB} MB exceeds ${providerLabel} limit of ${limitMB} MB ` +
      `after maximum compression. Reduce canvas size or remove layers.`,
    );
    this.imageBytes = imageBytes;
    this.limit = limit;
    this.providerLabel = providerLabel;
  }
}

const FORMAT_MIME: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

let webpEncodeSupported: boolean | null = null;

async function supportsWebPEncode(): Promise<boolean> {
  if (webpEncodeSupported !== null) return webpEncodeSupported;
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const blob = await canvasToFormat(c, "webp", 0.5);
  webpEncodeSupported = blob !== null && blob.type === "image/webp";
  return webpEncodeSupported;
}

function canvasToFormat(
  canvas: HTMLCanvasElement,
  format: ImageFormat,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      FORMAT_MIME[format],
      format === "png" ? undefined : quality,
    );
  });
}

function computeBudget(limits: InputLimits): number {
  if (limits.transport === "base64") {
    return Math.floor(limits.maxImageBytes / 1.34);
  }
  return limits.maxImageBytes;
}

async function filterSupportedFormats(formats: ImageFormat[]): Promise<ImageFormat[]> {
  const hasWebP = await supportsWebPEncode();
  return hasWebP ? formats : formats.filter((f) => f !== "webp");
}

export async function optimizeImageForProvider(
  source: Blob,
  limits: InputLimits,
  providerLabel: string,
): Promise<OptimizeResult> {
  const warnings: string[] = [];
  const budget = computeBudget(limits);
  const formats = await filterSupportedFormats(limits.formats);

  const bitmap = await createImageBitmap(source);
  let { width, height } = bitmap;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();

  if (limits.maxLongestSide && Math.max(width, height) > limits.maxLongestSide) {
    const scale = limits.maxLongestSide / Math.max(width, height);
    const newW = Math.round(width * scale / 8) * 8 || 8;
    const newH = Math.round(height * scale / 8) * 8 || 8;
    warnings.push(`Resized from ${width}×${height} to ${newW}×${newH} (provider max ${limits.maxLongestSide}px)`);
    const resized = await resizeBlob(
      await canvasToFormat(canvas, "png") as Blob,
      newW, newH,
    );
    const bm2 = await createImageBitmap(resized);
    canvas.width = newW;
    canvas.height = newH;
    canvas.getContext("2d")!.drawImage(bm2, 0, 0);
    bm2.close();
    width = newW;
    height = newH;
  }

  if (budget >= 30_000_000 && formats.includes("png")) {
    const blob = await canvasToFormat(canvas, "png");
    if (blob && blob.size <= budget) {
      return { blob, format: "png", quality: null, dimensions: { width, height }, warnings };
    }
  }

  if (source.size <= budget && source.size === (await canvasToFormat(canvas, "png"))?.size) {
    const sourceFormat = detectFormat(source);
    if (sourceFormat && formats.includes(sourceFormat)) {
      return { blob: source, format: sourceFormat, quality: null, dimensions: { width, height }, warnings };
    }
  }

  const lossyFormats = formats.filter((f): f is "jpeg" | "webp" => f !== "png");
  for (const fmt of lossyFormats) {
    const result = await tryLossyEncode(canvas, fmt, budget);
    if (result) {
      return { ...result, dimensions: { width, height }, warnings };
    }
  }

  const downscaled = await dimensionReduction(canvas, width, height, lossyFormats[0] ?? "jpeg", budget);
  if (downscaled) {
    warnings.push(
      `Reduced from ${width}×${height} to ${downscaled.dimensions.width}×${downscaled.dimensions.height} to fit ${providerLabel} size limit`,
    );
    return { ...downscaled, warnings };
  }

  const finalBlob = await canvasToFormat(canvas, lossyFormats[0] ?? "png", 0.7);
  throw new InputTooLargeError(finalBlob?.size ?? source.size, limits.maxImageBytes, providerLabel);
}

async function tryLossyEncode(
  canvas: HTMLCanvasElement,
  format: "jpeg" | "webp",
  budget: number,
): Promise<{ blob: Blob; format: ImageFormat; quality: number } | null> {
  const first = await canvasToFormat(canvas, format, 0.92);
  if (!first) return null;
  if (first.size <= budget) return { blob: first, format, quality: 0.92 };

  let lo = 0.7;
  let hi = 0.92;
  let bestBlob: Blob | null = null;
  let bestQ = 0;

  for (let i = 0; i < 4; i++) {
    const mid = (lo + hi) / 2;
    const blob = await canvasToFormat(canvas, format, mid);
    if (!blob) return null;
    if (blob.size <= budget) {
      bestBlob = blob;
      bestQ = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  if (bestBlob) return { blob: bestBlob, format, quality: bestQ };

  const lowest = await canvasToFormat(canvas, format, 0.7);
  if (lowest && lowest.size <= budget) return { blob: lowest, format, quality: 0.7 };

  return null;
}

async function dimensionReduction(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  format: "jpeg" | "webp",
  budget: number,
): Promise<{ blob: Blob; format: ImageFormat; quality: number; dimensions: { width: number; height: number } } | null> {
  const probe = await canvasToFormat(canvas, format, 0.7);
  if (!probe) return null;

  const scale = Math.sqrt(budget / probe.size) * 0.9;
  if (scale >= 1) return null;

  const newW = Math.round(width * scale / 8) * 8 || 8;
  const newH = Math.round(height * scale / 8) * 8 || 8;

  const pngBlob = await canvasToFormat(canvas, "png") as Blob;
  const resized = await resizeBlob(pngBlob, newW, newH);
  const bm = await createImageBitmap(resized);
  const outCanvas = document.createElement("canvas");
  outCanvas.width = newW;
  outCanvas.height = newH;
  outCanvas.getContext("2d")!.drawImage(bm, 0, 0);
  bm.close();

  const blob = await canvasToFormat(outCanvas, format, 0.8);
  if (blob && blob.size <= budget) {
    return { blob, format, quality: 0.8, dimensions: { width: newW, height: newH } };
  }
  return null;
}

function detectFormat(blob: Blob): ImageFormat | null {
  if (blob.type === "image/png") return "png";
  if (blob.type === "image/jpeg") return "jpeg";
  if (blob.type === "image/webp") return "webp";
  return null;
}
