// Server media read as bytes: downloads, and pictures sent on to the canvas or another view.

import { toast } from "sonner";
import { fetchMedia, mediaUrl } from "@/api/session";
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
async function fetchOk(url: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetchMedia(url, init);
  } catch {
    throw new Error("The server could not be reached");
  }
  if (!response.ok) throw new Error(unreadable(response.status));
  return response;
}

/** The bytes of a stored image: a server path or URL, a data: or blob: URL, or raw base64. */
export async function mediaBlob(image: string, init?: RequestInit): Promise<Blob> {
  if (isRawBase64(image)) return base64ToBlob(image);
  return (await fetchOk(image, init)).blob();
}

export async function mediaFile(
  image: string,
  filename: string,
  init?: RequestInit,
): Promise<File> {
  const blob = await mediaBlob(image, init);
  return new File([blob], filename, { type: blob.type });
}

/** The first `bytes` of a stored image, and whether they are all of it: raw
 * base64, data: and blob: URLs are read whole, as is a file whose server
 * ignores the range. */
export async function mediaHead(
  image: string,
  filename: string,
  bytes: number,
  init?: RequestInit,
): Promise<{ file: File; whole: boolean }> {
  if (isRawBase64(image) || /^(data|blob):/.test(image)) {
    return { file: await mediaFile(image, filename, init), whole: true };
  }
  const response = await fetchOk(image, { ...init, headers: { Range: `bytes=0-${bytes - 1}` } });
  const blob = await response.blob();
  return { file: new File([blob], filename, { type: blob.type }), whole: response.status !== 206 };
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

/** Hand the browser a blob to save under the name. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  clickDownload(url, filename);
  URL.revokeObjectURL(url);
}

/** Download a file the server serves as an attachment: the browser's
 * download manager streams it to disk, nothing is held in the page. */
export function downloadUrl(path: string, filename: string): void {
  clickDownload(mediaUrl(path), filename);
}

function clickDownload(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Save a stored file under the given name, else the one the server gives it. */
export async function downloadMedia(image: string, filename?: string): Promise<void> {
  if (isRawBase64(image)) {
    saveBlob(base64ToBlob(image), filename ?? "image.png");
    return;
  }
  const response = await fetchOk(image);
  const name = filename ?? dispositionName(response.headers.get("content-disposition"));
  saveBlob(await response.blob(), name ?? "download");
}

/** Open a stored file in a new tab as a local copy, so a token in its URL never reaches the tab's address
 * bar or the history. */
export function openMediaCopy(image: string): void {
  // Opened inside the click, before anything is awaited, so no popup blocker stops it
  const tab = window.open("", "_blank");
  if (!tab) return;
  tab.opener = null;
  mediaBlob(image)
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    })
    .catch((err: unknown) => {
      tab.close();
      failedWith("Could not open the file")(err);
    });
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
  saveBlob(content, `enso_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.zip`);
}

/** A rejection handler that says what failed and why. */
export function failedWith(title: string): (err: unknown) => void {
  return (err) => {
    console.error(`[media] ${title}`, err);
    toast.error(title, { description: err instanceof Error ? err.message : String(err) });
  };
}
