// The bytes of pictures a record or an entry names, by cid: this browser's
// stored copy first, else the server's by hash, whose hash is then remembered
// for that cid. A cid neither here nor on the server is reported lost.

import { blobUrl } from "@/api/blobs";
import { fetchMedia } from "@/api/session";
import { UserAbortError } from "@/lib/abort";
import { hashOf } from "@/lib/media/hash";
import { readBlobs, rememberHashes, type Hashed } from "./db";

export interface FetchProgress {
  /** Pictures fetched from the server so far, of `total`. */
  done: number;
  total: number;
  /** Bytes received so far. */
  bytes: number;
}

export interface FetchOptions {
  onProgress?: (progress: FetchProgress) => void;
  signal?: AbortSignal;
}

export interface Fetched {
  blobs: Map<string, Blob>;
  /** Cids whose bytes are neither stored here nor held by the server. */
  lost: string[];
}

const AT_ONCE = 2;

async function readAll(response: Response, onBytes: (count: number) => void): Promise<Blob> {
  if (!response.body) return response.blob();
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onBytes(value.byteLength);
  }
  return new Blob(chunks, { type: response.headers.get("content-type") ?? "" });
}

/** The bytes of `cids`, from here or from the server by `hashes`. Rejects
 * with UserAbortError when the signal stops it. */
export async function bytesFor(
  cids: Iterable<string>,
  hashes: Readonly<Record<string, string>>,
  options: FetchOptions = {},
): Promise<Fetched> {
  const { onProgress, signal } = options;
  const wanted = [...new Set(cids)];
  const blobs = await readBlobs(wanted).catch((err: unknown) => {
    console.warn("[inputs] stored pictures could not be read", err);
    return new Map<string, Blob>();
  });
  const lost: string[] = [];
  const queue: [cid: string, hash: string, url: string][] = [];
  for (const cid of wanted) {
    if (blobs.has(cid)) continue;
    const hash = hashOf(hashes, cid);
    const url = hash && blobUrl(hash);
    if (hash && url) queue.push([cid, hash, url]);
    else lost.push(cid);
  }
  if (queue.length === 0) return { blobs, lost };
  const progress: FetchProgress = { done: 0, total: queue.length, bytes: 0 };
  const report = () => onProgress?.({ ...progress });
  report();
  const rows = new Map<string, Hashed>();
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (signal?.aborted) throw new UserAbortError("Fetch cancelled");
      const [cid, hash, url] = next;
      const response = await fetchMedia(url, signal ? { signal } : undefined).catch(
        (err: unknown) => {
          throw signal?.aborted ? new UserAbortError("Fetch cancelled") : err;
        },
      );
      if (response.status === 404) {
        lost.push(cid);
      } else if (!response.ok) {
        throw new Error(`The server answered ${response.status} for a stored picture`);
      } else {
        const blob = await readAll(response, (count) => {
          progress.bytes += count;
          report();
        });
        blobs.set(cid, blob);
        rows.set(cid, { hash, size: blob.size });
      }
      progress.done += 1;
      report();
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, worker));
  } finally {
    if (rows.size > 0) {
      await rememberHashes(rows).catch((err: unknown) => {
        console.warn("[inputs] the fetched pictures' hashes could not be remembered", err);
      });
    }
  }
  return { blobs, lost };
}
