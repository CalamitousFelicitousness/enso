// Pictures redrawn at the size they are sent at, off the main thread: two at a
// time, Stop checked before each, the same Blob and fit made once per page.

import { serverInfoQuery } from "@/api/hooks/useServer";
import { queryClient } from "@/api/queryClient";
import { UserAbortError } from "@/lib/abort";
import type { Size } from "@/lib/inputs/types";
import { declaredSize } from "@/lib/media/rules";
import { fitTo, type Fit, type SizeRule } from "@/lib/media/sizeRule";
import { headerSize } from "./admit";
import { derivePicture, type DeriveInput } from "./deriveCore";
import type { DeriveRequest, DeriveResponse } from "./derive.worker";

interface DeriveHost {
  run(input: DeriveInput): Promise<Blob>;
  dispose(): void;
}

function workerHost(): DeriveHost {
  const worker = new Worker(new URL("./derive.worker.ts", import.meta.url), { type: "module" });
  const pending = new Map<number, { resolve: (b: Blob) => void; reject: (e: Error) => void }>();
  let next = 1;
  worker.addEventListener("message", (event: MessageEvent<DeriveResponse>) => {
    const msg = event.data;
    const job = pending.get(msg.jobId);
    if (!job) return;
    pending.delete(msg.jobId);
    if (msg.type === "derived") job.resolve(msg.blob);
    else job.reject(new Error(msg.message));
  });
  worker.addEventListener("error", (event) => {
    const err = new Error(event.message || "the picture worker failed");
    for (const job of pending.values()) job.reject(err);
    pending.clear();
    worker.terminate();
    host = null;
  });
  return {
    run: (input) =>
      new Promise((resolve, reject) => {
        const jobId = next++;
        pending.set(jobId, { resolve, reject });
        worker.postMessage({ jobId, input } satisfies DeriveRequest);
      }),
    dispose: () => worker.terminate(),
  };
}

function mainThreadHost(): DeriveHost {
  return {
    run: derivePicture,
    dispose: () => {},
  };
}

let host: DeriveHost | null = null;

function getHost(): DeriveHost {
  host ??= typeof Worker === "undefined" ? mainThreadHost() : workerHost();
  return host;
}

import.meta.hot?.dispose(() => {
  host?.dispose();
  host = null;
});

/** Pictures redrawn at once; each holds a decode of up to the canvas limit. */
const AT_ONCE = 2;

let running = 0;
const waiting: (() => void)[] = [];

async function inTurn<T>(task: () => Promise<T>): Promise<T> {
  if (running >= AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await task();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

const made = new WeakMap<Blob, Map<string, Promise<Blob>>>();

const fitId = (fit: Fit) => `${fit.mode}|${fit.width}x${fit.height}`;

/** `blob`, of `size` as this browser draws it, redrawn at `fit` as a PNG. A
 * signal aborted before the picture's turn stops it. */
export function fitBlob(blob: Blob, size: Size, fit: Fit, signal?: AbortSignal): Promise<Blob> {
  const byFit = made.get(blob) ?? new Map<string, Promise<Blob>>();
  made.set(blob, byFit);
  const id = fitId(fit);
  const known = byFit.get(id);
  if (known) return known;
  const pending = inTurn(() => {
    if (signal?.aborted) throw new UserAbortError("Upload cancelled");
    return getHost().run({ blob, size, fit });
  });
  byFit.set(id, pending);
  // a failed or stopped redraw is tried again next time
  pending.catch(() => byFit.delete(id));
  return pending;
}

/** "cat.jpg" as the PNG a redrawn copy is. */
export const pngName = (name: string) => `${name.replace(/\.[^./]+$/, "")}.png`;

/** The size the server's captioners resize a picture to; null when it declares none. */
export async function captionRule(): Promise<SizeRule | null> {
  const info = await queryClient.ensureQueryData(serverInfoQuery).catch(() => null);
  const wire = info?.limits?.caption;
  return wire ? declaredSize(wire).rule : null;
}

/** A picture as a captioner reads it: redrawn at the size the captioner
 * resizes to when that is smaller, else as it is, as is a picture whose
 * header gives no size. */
export async function captionPicture(
  blob: Blob,
  name: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; name: string }> {
  const [rule, size] = await Promise.all([captionRule(), headerSize(blob)]);
  const fit = rule && size ? fitTo(rule, size) : null;
  if (!fit || !size) return { blob, name };
  return { blob: await fitBlob(blob, size, fit, signal), name: pngName(name) };
}
