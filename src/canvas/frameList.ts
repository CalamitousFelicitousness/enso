import { frameBox, type FrameLayout } from "@/lib/inputs/layout";

/** A canvas frame identifier. Used by focus mode, dock collapse keys and
 * per-frame state lookups. Input frames carry their UUID; output and
 * processed are singular. */
export type FrameId = `input:${string}` | "output" | "processed";

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

export type ParsedFrameId =
  { kind: "input"; id: string } | { kind: "output" } | { kind: "processed" };

export function parseFrameId(fid: FrameId): ParsedFrameId {
  if (fid === "output") return { kind: "output" };
  if (fid === "processed") return { kind: "processed" };
  if (fid.startsWith("input:")) return { kind: "input", id: fid.slice(6) };
  throw new Error(`unknown FrameId: ${fid as string}`);
}

const PADDING = 40;
/** Reserve space above frame for an expanded glass dock panel (header + tabs + drawer + gap) */
const LABEL_HEIGHT = 160;
/** Bottom clearance for the floating canvas toolbar */
const TOOLBAR_RESERVE = 56;

/** Every visible frame in focus-nav order: the frames by their place in the
 * list, whichever column they sit in, then the output, then the processed
 * composite when it shows. */
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
  if (layout.showProcessedFrame) {
    frames.push({
      id: "processed",
      x: layout.processedX,
      y: 0,
      width: layout.outputDisplayW,
      height: layout.outputDisplayH,
    });
  }
  return frames;
}

/**
 * Computes viewport state to fit a single frame centered in the container.
 */
export function computeFocusViewport(
  frame: FrameBounds,
  containerW: number,
  containerH: number,
): { x: number; y: number; scale: number } {
  const availW = containerW - PADDING * 2;
  const availH = containerH - PADDING - (PADDING + TOOLBAR_RESERVE);
  const totalFrameH = LABEL_HEIGHT + frame.height;
  const scale = Math.min(availW / frame.width, availH / totalFrameH, 2);
  const x = (containerW - frame.width * scale) / 2 - frame.x * scale;
  const y = PADDING + (availH - totalFrameH * scale) / 2 + LABEL_HEIGHT * scale;
  return { x, y, scale };
}
