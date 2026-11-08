// Camera math for the canvases: zoom about a point, pan, fit a box, and the
// zoom limits. Values in, values out.

import type { Box, Insets, Point, Size, Viewport } from "./types";

/** Zoom limits as fractions of the unit scale: 2% to 3200% of image pixels. */
export const ZOOM_LIMITS = { min: 0.02, max: 32 } as const;

/** The largest stage scale a fit chooses: docks and hats are drawn at the
 * stage scale, and past this they crowd the frame they label. */
export const FIT_MAX_SCALE = 2;

export interface ScaleRange {
  min: number;
  max: number;
}

/** The stage scale at which one generation-frame pixel is one CSS pixel. */
export function unitScale(displayScale: number): number {
  return displayScale > 0 ? 1 / displayScale : 1;
}

export function scaleRange(unit: number): ScaleRange {
  return { min: ZOOM_LIMITS.min * unit, max: ZOOM_LIMITS.max * unit };
}

/** The next scale, held inside the range. A scale already outside it (a fit
 * may go below the minimum to show everything) can move back toward the
 * range but never further out, so a step never jumps. */
export function clampScale(next: number, current: number, range: ScaleRange): number {
  const lower = Math.min(range.min, current);
  const upper = Math.max(range.max, current);
  return Math.min(upper, Math.max(lower, next));
}

export function screenToWorld(vp: Viewport, point: Point): Point {
  return { x: (point.x - vp.x) / vp.scale, y: (point.y - vp.y) / vp.scale };
}

export function worldToScreen(vp: Viewport, point: Point): Point {
  return { x: point.x * vp.scale + vp.x, y: point.y * vp.scale + vp.y };
}

/** Whether two viewports are the same view. */
export function sameViewport(a: Viewport, b: Viewport): boolean {
  return a.x === b.x && a.y === b.y && a.scale === b.scale;
}

/** The viewport at `scale` that keeps the world point under `anchor` there. */
export function zoomTo(vp: Viewport, anchor: Point, scale: number): Viewport {
  const world = screenToWorld(vp, anchor);
  return { x: anchor.x - world.x * scale, y: anchor.y - world.y * scale, scale };
}

/** Zoom by `factor` about `anchor`, within the range. */
export function zoomAbout(
  vp: Viewport,
  anchor: Point,
  factor: number,
  range: ScaleRange,
): Viewport {
  return zoomTo(vp, anchor, clampScale(vp.scale * factor, vp.scale, range));
}

/** The part of the world the container shows. */
export function visibleWorld(vp: Viewport, container: Size): Box {
  const topLeft = screenToWorld(vp, { x: 0, y: 0 });
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: container.width / vp.scale,
    height: container.height / vp.scale,
  };
}

/** Whether the whole box is on screen. */
export function containsBox(vp: Viewport, container: Size, box: Box): boolean {
  const seen = visibleWorld(vp, container);
  return (
    box.x >= seen.x &&
    box.y >= seen.y &&
    box.x + box.width <= seen.x + seen.width &&
    box.y + box.height <= seen.y + seen.height
  );
}

/** The viewport at the same scale with `world` at the container's centre. */
export function centerOn(vp: Viewport, world: Point, container: Size): Viewport {
  return {
    x: container.width / 2 - world.x * vp.scale,
    y: container.height / 2 - world.y * vp.scale,
    scale: vp.scale,
  };
}

/** One unit of `unit` scale with the box's middle centred; without a box,
 * about the container's centre. */
export function actualSize(vp: Viewport, box: Box | null, container: Size, unit: number): Viewport {
  if (!box) return zoomTo(vp, { x: container.width / 2, y: container.height / 2 }, unit);
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return centerOn({ ...vp, scale: unit }, middle, container);
}

/** The viewport after a resize that keeps the world point under the centre. */
export function keepCenter(vp: Viewport, before: Size, after: Size): Viewport {
  return {
    x: vp.x + (after.width - before.width) / 2,
    y: vp.y + (after.height - before.height) / 2,
    scale: vp.scale,
  };
}

/** What the view shows: the container, and the box holding all the content. */
export interface Scene {
  container: Size;
  all: Box | null;
}

/** A view that follows nothing, after the content or the container changed:
 * "all" when it showed all of the content and would no longer, otherwise
 * the same world point under the centre. */
export function reframe(vp: Viewport, before: Scene, after: Scene): Viewport | "all" {
  const kept = keepCenter(vp, before.container, after.container);
  const showedAll = before.all !== null && containsBox(vp, before.container, before.all);
  const showsAll = after.all === null || containsBox(kept, after.container, after.all);
  return showedAll && !showsAll ? "all" : kept;
}

/** The zoom as a percentage of image pixels: 100 is one image pixel per CSS pixel. */
export function zoomPercent(vp: Viewport, unit: number): number {
  return (vp.scale / unit) * 100;
}

/** The percentages Zoom in and Zoom out step through; the ends are the limits. */
export const ZOOM_LADDER = [
  2, 5, 10, 25, 33, 50, 67, 100, 150, 200, 300, 400, 800, 1600, 3200,
] as const;

// A percentage within this of a step counts as on it, so 99.99999 steps past 100
const ON_STEP = 1e-6;

/** The next step past `percent` in `direction`; null past the last one. */
export function ladderStep(percent: number, direction: 1 | -1): number | null {
  if (direction > 0) return ZOOM_LADDER.find((step) => step > percent * (1 + ON_STEP)) ?? null;
  return [...ZOOM_LADDER].reverse().find((step) => step < percent * (1 - ON_STEP)) ?? null;
}

/** The viewport that shows `box` whole and centred inside the container less
 * the insets, at the largest scale up to `maxScale`. Null when the box or the
 * room left has no area. The zoom limits do not apply: a fit shows all. */
export function fitBox(
  box: Box,
  container: Size,
  insets: Insets,
  maxScale: number,
): Viewport | null {
  const roomW = container.width - insets.left - insets.right;
  const roomH = container.height - insets.top - insets.bottom;
  if (roomW <= 0 || roomH <= 0 || box.width <= 0 || box.height <= 0) return null;
  const scale = Math.min(roomW / box.width, roomH / box.height, maxScale);
  return {
    x: insets.left + (roomW - box.width * scale) / 2 - box.x * scale,
    y: insets.top + (roomH - box.height * scale) / 2 - box.y * scale,
    scale,
  };
}

/** The fit with the largest scale among several sets of insets. */
export function fitBoxBest(
  box: Box,
  container: Size,
  variants: readonly Insets[],
  maxScale: number,
): Viewport | null {
  let best: Viewport | null = null;
  for (const insets of variants) {
    const fit = fitBox(box, container, insets, maxScale);
    if (fit && (!best || fit.scale > best.scale)) best = fit;
  }
  return best;
}
