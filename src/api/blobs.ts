// The one sender of bytes to the media store, and the calls beside it: a claim
// asks which hashes the server holds and how much room it has, adopt takes an
// output the server already holds into the store. Bytes go as a raw body over
// XMLHttpRequest, the one browser API that reports upload progress.

import { UserAbortError } from "@/lib/abort";
import { isHash } from "@/lib/media/hash";
import { UploadRefused } from "@/lib/media/refused";
import type { UploadFailure } from "@/lib/media/text";
import { api, ApiError } from "./client";
import { formatErrorDetail } from "./errorDetail";
import type { ResBlobV2, ResClaimV2 } from "./types/media";

/** The failure a refused request names. `declared` is the size of the bytes
 * it carried, which a 507's `needed` counts beside the server's reserve and
 * the uploads in flight. */
export function failureOf(err: unknown, declared = 0): UploadFailure {
  if (!(err instanceof ApiError)) return { kind: "network" };
  if (err.status === 507) {
    const free = Number(err.detail?.["free"]);
    const needed = Number(err.detail?.["needed"]);
    if (!Number.isFinite(free) || !Number.isFinite(needed)) return { kind: "full" };
    return { kind: "space", room: Math.max(0, free - (needed - declared)), needed: declared };
  }
  if (err.status === 408) return { kind: "stalled" };
  if (err.status === 429) return { kind: "busy" };
  if (err.code === "media_store_off" && err.detail) {
    return { kind: "storeOff", message: err.detail.message };
  }
  return {
    kind: "server",
    message: formatErrorDetail(err.body) ?? `The server answered ${err.status} ${err.statusText}`,
  };
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface IngestOptions {
  /** The file name the server keeps for downloads. */
  name?: string;
  /** Bytes read once (PNG info, captions): the server keeps them an hour. */
  transient?: boolean;
  /** The bytes sent so far. */
  onProgress?: (sent: number) => void;
  signal?: AbortSignal;
}

/** Send bytes to the store; the server answers their hash, as new (201) or
 * already held (200). Rejects with UploadRefused, or UserAbortError when the
 * signal stops it. */
export function ingest(blob: Blob, options: IngestOptions = {}): Promise<ResBlobV2> {
  const { name, transient, onProgress, signal } = options;
  const query = new URLSearchParams();
  if (name) query.set("name", name);
  if (transient) query.set("transient", "true");
  const search = query.toString();
  return postRaw<ResBlobV2>(`/sdapi/v2/blobs${search ? `?${search}` : ""}`, blob, {
    onProgress,
    signal,
  }).catch((err: unknown) => {
    throw err instanceof ApiError
      ? new UploadRefused(failureOf(err, blob.size), { cause: err })
      : err;
  });
}

export interface RawOptions {
  /** The bytes sent so far. */
  onProgress?: ((sent: number) => void) | undefined;
  signal?: AbortSignal | undefined;
}

/** POST bytes as a raw body. Rejects with ApiError for a refusal,
 * UploadRefused when the server cannot be reached, or UserAbortError when
 * the signal stops it. */
export function postRaw<T>(path: string, blob: Blob, options: RawOptions = {}): Promise<T> {
  const { onProgress, signal } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UserAbortError("Upload cancelled"));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${api.getBaseUrl()}${path}`);
    const authorization = api.getAuthorization();
    if (authorization) xhr.setRequestHeader("Authorization", authorization);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    const abort = () => xhr.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const settled = () => signal?.removeEventListener("abort", abort);
    if (onProgress) xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      settled();
      const body = parsed(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
        return;
      }
      reject(new ApiError(xhr.status, xhr.statusText, body));
    };
    xhr.onerror = () => {
      settled();
      reject(new UploadRefused({ kind: "network" }));
    };
    xhr.onabort = () => {
      settled();
      reject(new UserAbortError("Upload cancelled"));
    };
    xhr.send(blob);
  });
}

const CLAIM_CHUNK = 1000;

export interface ClaimOptions {
  /** False for bytes read once: the claim touches them and leaves them to go within the hour. */
  keep?: boolean;
  signal?: AbortSignal;
}

/** Which hashes the server holds, keeping each one it holds for an hour, and
 * the room it has for `bytes` more. Rejects with UploadRefused, or
 * UserAbortError when the signal stops it. */
export async function claim(
  hashes: readonly string[],
  bytes: number,
  { keep = true, signal }: ClaimOptions = {},
): Promise<ResClaimV2> {
  const answer: ResClaimV2 = {
    present: [],
    missing: [],
    lost: [],
    space: { ok: true, free: 0, needed: 0 },
  };
  try {
    for (let start = 0; start === 0 || start < hashes.length; start += CLAIM_CHUNK) {
      const part = await api.post<ResClaimV2>(
        keep ? "/sdapi/v2/blobs/claim" : "/sdapi/v2/blobs/claim?keep=false",
        { hashes: hashes.slice(start, start + CLAIM_CHUNK), bytes: start === 0 ? bytes : 0 },
        signal,
      );
      if (start === 0) answer.space = part.space;
      answer.present.push(...part.present);
      answer.missing.push(...part.missing);
      answer.lost.push(...part.lost);
    }
  } catch (err) {
    if (signal?.aborted) throw new UserAbortError("Upload cancelled");
    throw new UploadRefused(failureOf(err), { cause: err });
  }
  return answer;
}

/** A file the server already holds: an output by its id, or a Gallery file by its path. */
export type AdoptOrigin = { outputId: string } | { path: string };

/** Take a file the server already holds into the store. */
export function adopt(origin: AdoptOrigin): Promise<ResBlobV2> {
  const body = "outputId" in origin ? { output_id: origin.outputId } : { path: origin.path };
  return api.post<ResBlobV2>("/sdapi/v2/blobs/adopt", body);
}

const BLOB_PATH = "/sdapi/v2/blobs/";

/** The path a blob is served at, null for anything but a hash; load it
 * through mediaUrl. */
export function blobUrl(hash: string): string | null {
  return isHash(hash) ? `${BLOB_PATH}${hash}` : null;
}

/** The hash a blob's URL names, else null. */
export function blobHash(url: string): string | null {
  const at = url.lastIndexOf(BLOB_PATH);
  if (at < 0) return null;
  const hash = url.slice(at + BLOB_PATH.length);
  return isHash(hash) ? hash : null;
}
