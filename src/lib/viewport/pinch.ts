import { zoomAbout, type ScaleRange } from "./camera";
import type { Point, Viewport } from "./types";

export type PointerPair = readonly [Point, Point];

/** How two fingers moved between two samples. */
export interface PinchStep {
  /** The ratio of the finger distances; 1 when the first sample had none. */
  factor: number;
  /** The fingers' midpoint at the later sample. */
  midpoint: Point;
  dx: number;
  dy: number;
}

/** Below this a distance is treated as fingers on one spot. */
const MIN_DISTANCE = 1e-6;

function midpointOf([a, b]: PointerPair): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distanceOf([a, b]: PointerPair): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pinchStep(prev: PointerPair, next: PointerPair): PinchStep {
  const before = midpointOf(prev);
  const after = midpointOf(next);
  const from = distanceOf(prev);
  const to = distanceOf(next);
  return {
    factor: from > MIN_DISTANCE && to > MIN_DISTANCE ? to / from : 1,
    midpoint: after,
    dx: after.x - before.x,
    dy: after.y - before.y,
  };
}

/**
 * Pan by the midpoint's move, then zoom about the new midpoint, so the world
 * point under the first midpoint ends under the last.
 */
export function applyPinch(vp: Viewport, step: PinchStep, range: ScaleRange): Viewport {
  const panned = { x: vp.x + step.dx, y: vp.y + step.dy, scale: vp.scale };
  return zoomAbout(panned, step.midpoint, step.factor, range);
}
