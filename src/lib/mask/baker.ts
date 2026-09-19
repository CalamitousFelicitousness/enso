// Turns a frame's pending mask strokes into mask layers. One bake per frame
// at a time; strokes committed meanwhile stay in maskLines (rendered as
// pending lines) and go into the next bake. A result is applied only if the
// frame's masks, size and consumed lines are still what the bake saw.

import { useCanvasStore, type MaskLine, type MaskObjectLayer } from "@/stores/canvasStore";
import { useGenerationStore } from "@/stores/generationStore";
import type { CanvasLayer } from "@/stores/canvasStore";
import type { InputFrame } from "@/canvas/inputFrames";
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
  masks: MaskObjectLayer[];
}

interface Job {
  frameId: string;
  lines: MaskLine[];
  snapshot: Snapshot;
}

interface FrameState {
  inFlight: Job | null;
  failures: number;
  failedLines: MaskLine[] | null;
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

const isMask = (l: CanvasLayer): l is MaskObjectLayer => l.type === "mask";

function findFrame(frameId: string): InputFrame | undefined {
  return useCanvasStore.getState().inputFrames.find((f) => f.id === frameId);
}

function toSource(m: MaskObjectLayer): MaskSource {
  return {
    id: m.id,
    blob: m.blob,
    x: m.x,
    y: m.y,
    width: m.width,
    height: m.height,
    scaleX: m.scaleX,
    scaleY: m.scaleY,
    rotation: m.rotation,
  };
}

function snapshotMatches(snap: Snapshot, frame: InputFrame): boolean {
  const { width, height } = useGenerationStore.getState();
  if (frame.mode !== "initial" || snap.width !== width || snap.height !== height) return false;
  const masks = frame.layers.filter(isMask);
  if (masks.length !== snap.masks.length) return false;
  return masks.every((m, i) => {
    const o = snap.masks[i];
    return (
      m.id === o.id &&
      m.blob === o.blob &&
      m.x === o.x &&
      m.y === o.y &&
      m.width === o.width &&
      m.height === o.height &&
      m.scaleX === o.scaleX &&
      m.scaleY === o.scaleY &&
      m.rotation === o.rotation &&
      m.visible === o.visible
    );
  });
}

function reconcile(frameId: string): void {
  const fs = stateFor(frameId);
  if (fs.inFlight) return;
  const frame = findFrame(frameId);
  if (!frame || frame.mode !== "initial" || frame.maskLines.length === 0) return;
  if (fs.failedLines !== frame.maskLines) {
    fs.failures = 0;
    fs.failedLines = null;
  }
  if (fs.failures >= MAX_FAILURES) return;
  const { width, height } = useGenerationStore.getState();
  if (width <= 0 || height <= 0) return;

  const lines = frame.maskLines;
  const drawable = lines.filter((l) => l.points.length >= 4);
  if (drawable.length === 0) {
    useCanvasStore.getState().clearMaskLinesInFrame(frameId);
    return;
  }
  const bakeHost = getHost();
  if (!bakeHost) return;

  const masks = frame.layers.filter(isMask);
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
    frame.maskLines.length >= job.lines.length &&
    job.lines.every((line, i) => frame.maskLines[i] === line);
  if (!current) {
    // The store moved on; the lines are still pending, so bake them again.
    reconcile(job.frameId);
    return;
  }

  const continued = assignIdentities(output.regions);
  const layers: MaskObjectLayer[] = output.regions.map((region, i) => {
    const prevId = continued[i];
    const prev = prevId
      ? (frame.layers.find((l) => l.id === prevId) as MaskObjectLayer)
      : undefined;
    rememberMaskBitmap(region.blob, region.bitmap);
    return {
      id: prev?.id ?? crypto.randomUUID(),
      type: "mask",
      name: prev?.name ?? `Mask ${region.x},${region.y}`,
      visible: prev?.visible ?? true,
      opacity: prev?.opacity ?? 1,
      locked: prev?.locked ?? true,
      imageData: URL.createObjectURL(region.blob),
      blob: region.blob,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    };
  });
  useCanvasStore.getState().applyMaskBake(job.frameId, { consumedLines: job.lines.length, layers });
  fs.failures = 0;
  fs.failedLines = null;
  reconcile(job.frameId);
}

function recordFailure(fs: FrameState, job: Job, err: unknown): void {
  fs.inFlight = null;
  fs.failures += 1;
  fs.failedLines = findFrame(job.frameId)?.maskLines ?? null;
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
