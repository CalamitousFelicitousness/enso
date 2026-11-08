import type { Size } from "./types";

/** The fields of a WheelEvent the canvas reads. */
export interface WheelInput {
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** A wheel event in CSS pixels. */
export interface NormalizedWheel {
  dx: number;
  dy: number;
  /** Ctrl or Cmd held: a trackpad pinch arrives this way in Chrome, Firefox and Safari 15+. */
  pinch: boolean;
  shift: boolean;
  /** The browser reported pixels, as trackpads and Chromium's wheel do. */
  pixels: boolean;
}

export type WheelMode = "pan" | "zoom";

export type WheelIntent =
  { kind: "pan"; dx: number; dy: number } | { kind: "zoom"; factor: number } | null;

const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const LINE_PX = 16;

/** One 100 px notch is one zoom step. */
const WHEEL_RATE = 0.0022;
const WHEEL_FACTOR_MIN = 0.8;
const WHEEL_FACTOR_MAX = 1.25;
/** Pixel deltas below this with Ctrl are pinch updates, not wheel notches. */
const PINCH_DELTA_MAX = 40;
const PINCH_DELTA_CLAMP = 10;
const PINCH_RATE = 0.01;

/**
 * Deltas in CSS pixels. `deltaMode` is read first: Firefox reports lines
 * for a mouse wheel only when the mode is read before the deltas.
 */
export function normalizeWheel(e: WheelInput, container: Size): NormalizedWheel {
  const mode = e.deltaMode;
  let dx = e.deltaX;
  let dy = e.deltaY;
  if (mode === DOM_DELTA_LINE) {
    dx *= LINE_PX;
    dy *= LINE_PX;
  } else if (mode !== DOM_DELTA_PIXEL) {
    dx *= container.width;
    dy *= container.height;
  }
  return {
    dx,
    dy,
    pinch: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    pixels: mode === DOM_DELTA_PIXEL,
  };
}

/** The zoom factor of a plain wheel step. */
export function wheelZoomFactor(dy: number): number {
  const factor = Math.exp(-dy * WHEEL_RATE);
  return Math.min(WHEEL_FACTOR_MAX, Math.max(WHEEL_FACTOR_MIN, factor));
}

/**
 * The zoom factor of a Ctrl or Cmd wheel event: a pinch update is small and
 * follows the fingers, a notch with Ctrl is one zoom step.
 */
export function ctrlZoomFactor(dy: number, pixels: boolean): number {
  if (pixels && Math.abs(dy) < PINCH_DELTA_MAX) {
    const clamped = Math.min(PINCH_DELTA_CLAMP, Math.max(-PINCH_DELTA_CLAMP, dy));
    return Math.exp(-clamped * PINCH_RATE);
  }
  return wheelZoomFactor(dy);
}

/** What a wheel event does to the camera under the wheel setting. */
export function wheelIntent(w: NormalizedWheel, mode: WheelMode): WheelIntent {
  if (w.pinch) return w.dy === 0 ? null : { kind: "zoom", factor: ctrlZoomFactor(w.dy, w.pixels) };
  if (w.shift) {
    // Chromium on Windows and Linux already turns Shift+wheel into deltaX
    const dx = w.dx !== 0 ? w.dx : w.dy;
    return dx === 0 ? null : { kind: "pan", dx: -dx, dy: 0 };
  }
  if (mode === "zoom") return w.dy === 0 ? null : { kind: "zoom", factor: wheelZoomFactor(w.dy) };
  return w.dx === 0 && w.dy === 0 ? null : { kind: "pan", dx: -w.dx, dy: -w.dy };
}
