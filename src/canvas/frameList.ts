import type { CanvasLayout } from "./useControlFrameLayout";

export type FrameId = "input" | "output" | "processed" | `control:${number}`;

export interface FrameBounds {
  id: FrameId;
  x: number;
  y: number;
  width: number;
  height: number;
}

const PADDING = 40;
/** Reserve space above frame for an expanded glass dock panel (header + tabs + drawer + gap) */
const LABEL_HEIGHT = 160;
/** Bottom clearance for the floating canvas toolbar */
const TOOLBAR_RESERVE = 56;

/**
 * Returns all visible frames sorted left-to-right.
 * Order: control frames (reversed — they accumulate rightmost-first in layout),
 * input, output, processed (if visible).
 */
export function getOrderedFrames(layout: CanvasLayout): FrameBounds[] {
  const frames: FrameBounds[] = [];

  // Control frames are laid out with negative X, last entry is leftmost
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

  // Input frame
  frames.push({
    id: "input",
    x: layout.inputX,
    y: 0,
    width: layout.displayW,
    height: layout.displayH,
  });

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
  const y =
    PADDING + (availH - totalFrameH * scale) / 2 + LABEL_HEIGHT * scale;
  return { x, y, scale };
}
