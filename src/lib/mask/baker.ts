// Turns a frame's pending mask strokes into mask layers. One bake per frame
// at a time; strokes committed meanwhile stay pending (rendered as lines)
// and go into the next bake. A result is applied only if the
// frame's masks, size and consumed lines are still what the bake saw.

import { useCanvasStore } from "@/stores/canvasStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useInputStore } from "@/stores/inputStore";
import type { Frame, MaskObject, MaskStroke } from "@/lib/inputs/types";
import { assignIdentities } from "./identity";
import { rememberMaskBitmap } from "./bitmaps";
import type { BakeInput, BakeOutput, BakeRequest, BakeResponse, MaskSource } from "./protocol";

/** Failures tolerated for one set of pending lines before the frame is left
 * alone. Pending lines still export at submit, so nothing is lost. */
const MAX_FAILURES = 2;

interface BakeHost {
  run(input: BakeInput): Promise<BakeOutput>;
  dispose(): void;
}

let host: BakeHost | null | undefined;

function createWorkerHost(): BakeHost {
  const worker = new Worker(new URL("./bake.worker.ts", import.meta.url), { type: "module" });
  const pending = new Map<
    number,
    { resolve: (o: BakeOutput) => void; reject: (e: Error) => void }
  >();
  let nextJobId = 1;
  worker.addEventListener("message", (event: MessageEvent<BakeResponse>) => {
    const msg = event.data;
    const job = pending.get(msg.jobId);
    if (!job) return;
    pending.delete(msg.jobId);
    if (msg.type === "bake") job.resolve(msg.output);
    else job.reject(new Error(msg.message));
  });
  worker.addEventListener("error", (event) => {
    const err = new Error(event.message || "mask bake worker failed");
    for (const job of pending.values()) job.reject(err);
    pending.clear();
    worker.terminate();
    host = undefined;
  });
  return {
    run: (input) =>
      new Promise((resolve, reject) => {
        const jobId = nextJobId++;
        pending.set(jobId, { resolve, reject });
        const req: BakeRequest = { type: "bake", jobId, input };
        worker.postMessage(req);
      }),
    dispose: () => worker.terminate(),
  };
}

function createMainThreadHost(): BakeHost {
  return {
    run: (input) => import("./bakeCore").then((m) => m.bakeMasks(input)),
    dispose: () => {},
  };
}

function getHost(): BakeHost | null {
  if (host !== undefined) return host;
  if (typeof OffscreenCanvas === "undefined") {
    console.warn("Mask baking needs OffscreenCanvas; strokes stay as pending lines.");
    host = null;
  } else {
    host = typeof Worker === "undefined" ? createMainThreadHost() : createWorkerHost();
  }
  return host;
}

import.meta.hot?.dispose(() => {
  host?.dispose();
  host = undefined;
});

interface Snapshot {
  width: number;
  height: number;
  masks: MaskObject[];
}

interface Job {
  frameId: string;
  lines: MaskStroke[];
  snapshot: Snapshot;
}

interface FrameState {
  inFlight: Job | null;
  failures: number;
  failedLines: MaskStroke[] | null;
}

const frames = new Map<string, FrameState>();

function stateFor(frameId: string): FrameState {
  let fs = frames.get(frameId);
  if (!fs) {
    fs = { inFlight: null, failures: 0, failedLines: null };
    frames.set(frameId, fs);
  }
  return fs;
}

function findFrame(frameId: string): Frame | undefined {
  return useInputStore.getState().frames.find((f) => f.id === frameId);
}

function toSource(m: MaskObject): MaskSource {
  return { id: m.id, blob: m.blob, width: m.width, height: m.height, ...m.transform };
}

function snapshotMatches(snap: Snapshot, frame: Frame): boolean {
  const { width, height } = useGenerationStore.getState();
  if (frame.role !== "initial" || snap.width !== width || snap.height !== height) return false;
  const masks = frame.mask.objects;
  if (masks.length !== snap.masks.length) return false;
  // a mask edit makes a new transform object, so identity is equality
  return masks.every((m, i) => {
    const o = snap.masks[i];
    return (
      m.id === o.id &&
      m.blob === o.blob &&
      m.width === o.width &&
      m.height === o.height &&
      m.transform === o.transform &&
      m.visible === o.visible
    );
  });
}

function reconcile(frameId: string): void {
  const fs = stateFor(frameId);
  if (fs.inFlight) return;
  const frame = findFrame(frameId);
  if (!frame || frame.role !== "initial" || frame.mask.strokes.length === 0) return;
  if (fs.failedLines !== frame.mask.strokes) {
    fs.failures = 0;
    fs.failedLines = null;
  }
  if (fs.failures >= MAX_FAILURES) return;
  const { width, height } = useGenerationStore.getState();
  if (width <= 0 || height <= 0) return;

  const lines = frame.mask.strokes;
  const drawable = lines.filter((l) => l.points.length >= 4);
  if (drawable.length === 0) {
    useInputStore.getState().clearStrokes(frameId);
    return;
  }
  const bakeHost = getHost();
  if (!bakeHost) return;

  const masks = frame.mask.objects;
  const job: Job = { frameId, lines, snapshot: { width, height, masks } };
  fs.inFlight = job;
  const input: BakeInput = {
    width,
    height,
    masks: masks.map(toSource),
    lines: drawable,
    color: useCanvasStore.getState().maskColor.slice(0, 7),
  };
  bakeHost.run(input).then(
    (output) => applyResult(fs, job, output),
    (err: unknown) => recordFailure(fs, job, err),
  );
}

function applyResult(fs: FrameState, job: Job, output: BakeOutput): void {
  fs.inFlight = null;
  const frame = findFrame(job.frameId);
  const current =
    frame &&
    snapshotMatches(job.snapshot, frame) &&
    frame.mask.strokes.length >= job.lines.length &&
    job.lines.every((line, i) => frame.mask.strokes[i] === line);
  if (!current) {
    // The store moved on; the lines are still pending, so bake them again.
    reconcile(job.frameId);
    return;
  }

  const continued = assignIdentities(output.regions);
  const objects: MaskObject[] = output.regions.map((region, i) => {
    const prevId = continued[i];
    const prev = prevId ? frame.mask.objects.find((m) => m.id === prevId) : undefined;
    rememberMaskBitmap(region.blob, region.bitmap);
    return {
      id: prev?.id ?? crypto.randomUUID(),
      // every bake draws new pixels, so every region is new content
      cid: crypto.randomUUID(),
      blob: region.blob,
      name: prev?.name ?? `Mask ${region.x},${region.y}`,
      visible: prev?.visible ?? true,
      locked: prev?.locked ?? true,
      width: region.width,
      height: region.height,
      transform: { x: region.x, y: region.y, scaleX: 1, scaleY: 1, rotation: 0 },
    };
  });
  useInputStore.getState().applyBake(job.frameId, job.lines.length, objects);
  fs.failures = 0;
  fs.failedLines = null;
  reconcile(job.frameId);
}

function recordFailure(fs: FrameState, job: Job, err: unknown): void {
  fs.inFlight = null;
  fs.failures += 1;
  fs.failedLines = findFrame(job.frameId)?.mask.strokes ?? null;
  console.error("Mask bake failed", err);
  if (fs.failures >= MAX_FAILURES) {
    console.warn("Mask baking paused for this frame; its strokes stay pending and still export.");
    return;
  }
  reconcile(job.frameId);
}

/** Bake the frame's pending strokes when nothing is in flight for it. Safe
 * to call on every render that sees pending lines. */
export function requestMaskBake(frameId: string): void {
  queueMicrotask(() => reconcile(frameId));
}
