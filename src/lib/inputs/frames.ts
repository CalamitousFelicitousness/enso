import { frameBox, type FrameLayout } from "./layout";

/** A canvas frame identifier. Used by focus mode, dock collapse keys and
 * per-frame state lookups. Input frames carry their UUID; the output is
 * singular. */
export type FrameId = `input:${string}` | "output";

export interface FrameBounds {
  id: FrameId;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Build a FrameId from a frame's id. */
export function inputFrameId(uuid: string): FrameId {
  return `input:${uuid}`;
}

export type ParsedFrameId = { kind: "input"; id: string } | { kind: "output" };

export function parseFrameId(fid: FrameId): ParsedFrameId {
  if (fid === "output") return { kind: "output" };
  if (fid.startsWith("input:")) return { kind: "input", id: fid.slice(6) };
  throw new Error(`unknown FrameId: ${fid as string}`);
}

/** Every visible frame in focus-nav order: the frames by their place in the
 * list, whichever column they sit in, then the output. */
export function getOrderedFrames(layout: FrameLayout): FrameBounds[] {
  const frames: FrameBounds[] = layout.frames.map((f) => ({
    id: inputFrameId(f.frameId),
    ...frameBox(f),
  }));
  frames.push({
    id: "output",
    x: layout.outputX,
    y: 0,
    width: layout.outputDisplayW,
    height: layout.outputDisplayH,
  });
  return frames;
}
