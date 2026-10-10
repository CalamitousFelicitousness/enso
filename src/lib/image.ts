export function base64ToImage(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
  });
}

export function imageToBase64(canvas: HTMLCanvasElement, mimeType = "image/png"): string {
  return canvas.toDataURL(mimeType).split(",")[1];
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export interface LoadedImageFile {
  file: File;
  objectUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}

/** Copy an image's bytes into memory and decode its dimensions. A File from
 * a drop or file input is a lazy reference to the path on disk, which can
 * move or change before the bytes are persisted or uploaded. */
export async function loadImageFile(file: File): Promise<LoadedImageFile> {
  const snapshot = new File([await file.arrayBuffer()], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  });
  const objectUrl = URL.createObjectURL(snapshot);
  const img = new Image();
  const decoded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Could not decode ${file.name}`));
  });
  img.src = objectUrl;
  try {
    await decoded;
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
  return {
    file: snapshot,
    objectUrl,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
  };
}

/** Strip `data:...;base64,` prefix from a data URI, returning raw base64. */
export function stripDataPrefix(dataUri: string): string {
  const idx = dataUri.indexOf(",");
  return idx >= 0 ? dataUri.slice(idx + 1) : dataUri;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** MIME type of a live preview frame: WebP when the server kept its transparency, JPEG otherwise. */
export function previewMimeType(frame: ArrayBuffer): string {
  const tag = String.fromCharCode(...new Uint8Array(frame, 0, Math.min(12, frame.byteLength)));
  return tag.startsWith("RIFF") && tag.slice(8) === "WEBP" ? "image/webp" : "image/jpeg";
}

export function createObjectUrl(base64: string, mimeType = "image/png"): string {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
  return URL.createObjectURL(blob);
}
