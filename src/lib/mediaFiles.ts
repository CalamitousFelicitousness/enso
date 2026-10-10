// Server media read as bytes: downloads, and pictures sent on to the canvas or another view.

import { toast } from "sonner";
import { fetchMedia } from "@/api/session";
import { base64ToBlob, generateImageFilename } from "@/lib/utils";

/** Why a file could not be read, worded for a toast's description. */
function unreadable(status: number): string {
  if (status === 401 || status === 403)
    return "The server refused it; check the credentials under Settings, Connection";
  if (status === 404) return "It is no longer on the server";
  return `The server answered ${status}`;
}

/** Results recorded before durable output URLs hold raw base64. */
const isRawBase64 = (image: string) =>
  !image.startsWith("/") && !/^(data|blob|https?):/.test(image);

/** The server's answer for a stored file, or the reason it has none, worded. */
async function fetchOk(url: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetchMedia(url);
  } catch {
    throw new Error("The server could not be reached");
  }
  if (!response.ok) throw new Error(unreadable(response.status));
  return response;
}

/** The bytes of a stored image: a server path or URL, a data: or blob: URL, or raw base64. */
export async function mediaBlob(image: string): Promise<Blob> {
  if (isRawBase64(image)) return base64ToBlob(image);
  return (await fetchOk(image)).blob();
}

export async function mediaFile(image: string, filename: string): Promise<File> {
  const blob = await mediaBlob(image);
  return new File([blob], filename, { type: blob.type });
}

/** The filename a Content-Disposition header names, if any. */
export function dispositionName(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*=utf-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // a malformed encoding falls back to the plain form
    }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] ?? null;
}

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Save a stored file under the given name, else the one the server gives it. */
export async function downloadMedia(image: string, filename?: string): Promise<void> {
  if (isRawBase64(image)) {
    save(base64ToBlob(image), filename ?? "image.png");
    return;
  }
  const response = await fetchOk(image);
  const name = filename ?? dispositionName(response.headers.get("content-disposition"));
  save(await response.blob(), name ?? "download");
}

/** Download every image of the given results as one zip. */
export async function downloadAllAsZip(
  results: { images: string[]; info: string }[],
): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  let fileIndex = 0;
  for (const result of results) {
    for (let ii = 0; ii < result.images.length; ii++) {
      const filename = generateImageFilename(result.info, ii);
      zip.file(
        `${String(fileIndex).padStart(4, "0")}_${filename}`,
        await mediaBlob(result.images[ii]),
      );
      fileIndex++;
    }
  }
  const content = await zip.generateAsync({ type: "blob" });
  save(content, `enso_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.zip`);
}

/** A rejection handler that says what failed and why. */
export function failedWith(title: string): (err: unknown) => void {
  return (err) => {
    console.error(`[media] ${title}`, err);
    toast.error(title, { description: err instanceof Error ? err.message : String(err) });
  };
}
