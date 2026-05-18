import type { CanvasLayout } from "./useControlFrameLayout";

/** A canvas frame identifier. Used by focus mode + panelCollapsedOverrides
 * keys + per-frame state lookups. Input frames carry their UUID; output and
 * processed are singular; ControlNet units are indexed.
 *
 * The bare `"input"` literal remains in the union as a transitional value
 * for persisted state from canvasStore v1 (single-Input legacy). 's
 * v1->v2 migration converts those to `input:${id}` form; the bare literal
 * is removed from the union in the canvasStore capstone step. */
export type FrameId = "input" | `input:${string}` | "output" | "processed" | `control:${number}`;

export interface FrameBounds {
  id: FrameId;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Build a per-Input-frame FrameId from an InputFrame.id. */
export function inputFrameId(uuid: string): FrameId {
  return `input:${uuid}`;
}

/** Discriminated representation of a FrameId. The bare legacy `"input"`
 * surfaces here as `{ kind: "input", id: "" }` so callers can detect and
 * handle stale persisted state without a separate branch. */
export type ParsedFrameId =
  | { kind: "input"; id: string }
  | { kind: "output" }
  | { kind: "processed" }
  | { kind: "control"; index: number };

export function parseFrameId(fid: FrameId): ParsedFrameId {
  if (fid === "output") return { kind: "output" };
  if (fid === "processed") return { kind: "processed" };
  if (fid === "input") return { kind: "input", id: "" };
  if (fid.startsWith("input:")) return { kind: "input", id: fid.slice(6) };
  if (fid.startsWith("control:")) {
    const n = Number(fid.slice(8));
    if (Number.isFinite(n)) return { kind: "control", index: n };
  }
  throw new Error(`unknown FrameId: ${fid as string}`);
}

const PADDING = 40;
/** Reserve space above frame for an expanded glass dock panel (header + tabs + drawer + gap) */
const LABEL_HEIGHT = 160;
/** Bottom clearance for the floating canvas toolbar */
const TOOLBAR_RESERVE = 56;

/**
 * Returns all visible frames in canvas-mode focus-nav order.
 *
 * Order: control frames left-to-right (reversed since the layout accumulates
 * negative-X-first), then Input frames top-to-bottom from layout.inputFrames,
 * then output, then processed if visible. Bounds come from each layout entry's
 * display-space dimensions; Reference-mode Input frames use motherW/motherH,
 * Initial-mode use displayW/displayH.
 */
export function getOrderedFrames(layout: CanvasLayout): FrameBounds[] {
  const frames: FrameBounds[] = [];

  // Control frames are laid out with negative X, last entry is leftmost.
  const reversed = [...layout.controlFrames].reverse();
  for (const cf of reversed) {
    frames.push({
      id: `control:${cf.unitIndex}`,
      x: cf.x,
      y: cf.y,
      width: cf.width,
      height: cf.height,
    });
  }

  // Input frames in store order (top-to-bottom vertical stack).
  for (const f of layout.inputFrames) {
    if (f.kind === "initial") {
      frames.push({
        id: inputFrameId(f.frameId),
        x: f.x,
        y: f.y,
        width: f.displayW,
        height: f.displayH,
      });
    } else {
      frames.push({
        id: inputFrameId(f.frameId),
        x: f.x,
        y: f.y,
        width: f.motherW,
        height: f.motherH,
      });
    }
  }

  // Output frame
  frames.push({
    id: "output",
    x: layout.outputX,
    y: 0,
    width: layout.displayW,
    height: layout.displayH,
  });

  // Processed frame (if visible)
  if (layout.showProcessedFrame) {
    frames.push({
      id: "processed",
      x: layout.processedX,
      y: 0,
      width: layout.displayW,
      height: layout.displayH,
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
