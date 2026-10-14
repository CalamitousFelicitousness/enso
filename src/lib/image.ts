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
