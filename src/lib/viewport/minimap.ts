// The minimap's geometry: its box, the projection from the world into it, the
// viewport's rectangle, a drag in it, and whether the canvas has room for it.
// Map units are CSS pixels at a 16 px root font.

import { fitBox, screenToWorld, visibleWorld, worldToScreen } from "./camera";
import { CHROME_GAP, unionBoxes, type ChromeBoxes } from "./insets";
import type { Box, Point, Size, Viewport } from "./types";

/** The longest side of the drawn area, in map units. */
export const MINIMAP_SIDE = 160;
/** Between the drawn area and the map's edge, in map units. */
export const MINIMAP_PADDING = 6;
/** The shorter side is at least this share of the longer one. */
const MIN_ASPECT = 0.5;
/** The viewport's rectangle is never thinner than this, in map units. */
export const MIN_RECT = 2;

/** World to map: map = world * scale + (x, y). */
export type Projection = Viewport;

/** The map's box: the bounds' aspect, held between 1:2 and 2:1, inside a
 * square of `side`, plus the padding on each side. */
export function minimapSize(bounds: Size, side = MINIMAP_SIDE, padding = MINIMAP_PADDING): Size {
  const aspect = bounds.width > 0 && bounds.height > 0 ? bounds.width / bounds.height : 1;
  const held = Math.min(1 / MIN_ASPECT, Math.max(MIN_ASPECT, aspect));
  const width = held >= 1 ? side : side * held;
  const height = held >= 1 ? side / held : side;
  return { width: width + padding * 2, height: height + padding * 2 };
}

/** The bounds centred in the box inside the padding; null when either is empty. */
export function minimapProjection(
  bounds: Box,
  box: Size,
  padding = MINIMAP_PADDING,
): Projection | null {
  const inset = { top: padding, right: padding, bottom: padding, left: padding };
  return fitBox(bounds, box, inset, Infinity);
}

export function project(p: Projection, world: Point): Point {
  return worldToScreen(p, world);
}

export function unproject(p: Projection, map: Point): Point {
  return screenToWorld(p, map);
}

export function projectBox(p: Projection, box: Box): Box {
  const { x, y } = project(p, box);
  return { x, y, width: box.width * p.scale, height: box.height * p.scale };
}

/** What the container shows, on the map, at least MIN_RECT across each way. */
export function viewportRect(vp: Viewport, container: Size, p: Projection): Box {
  const seen = projectBox(p, visibleWorld(vp, container));
  const width = Math.max(MIN_RECT, seen.width);
  const height = Math.max(MIN_RECT, seen.height);
  return {
    x: seen.x - (width - seen.width) / 2,
    y: seen.y - (height - seen.height) / 2,
    width,
    height,
  };
}

/** What the map covers: the content, and the middle of what the container
 * shows, so the viewport's rectangle always reaches onto it. */
export function minimapBounds(content: Box | null, seen: Box): Box {
  const middle = { x: seen.x + seen.width / 2, y: seen.y + seen.height / 2, width: 0, height: 0 };
  return content ? (unionBoxes([content, middle]) ?? seen) : seen;
}

/** The rectangle as drawn: held `inset` inside the map's edges, at least
 * MIN_RECT across, so a view larger than the map outlines the map. */
export function drawnRect(rect: Box, box: Size, inset: number): Box {
  const span = (a: number, b: number, hi: number): [number, number] => {
    const start = Math.min(hi, Math.max(inset, a));
    const end = Math.min(hi, Math.max(inset, b));
    if (end - start >= MIN_RECT) return [start, end];
    return start + MIN_RECT <= hi ? [start, start + MIN_RECT] : [hi - MIN_RECT, hi];
  };
  const [x1, x2] = span(rect.x, rect.x + rect.width, box.width - inset);
  const [y1, y2] = span(rect.y, rect.y + rect.height, box.height - inset);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** The view after a drag on the map from `from` to `to`: the viewport's
 * rectangle moves with the pointer. */
export function dragView(start: Viewport, p: Projection, from: Point, to: Point): Viewport {
  const dx = (to.x - from.x) / p.scale;
  const dy = (to.y - from.y) / p.scale;
  return { x: start.x - dx * start.scale, y: start.y - dy * start.scale, scale: start.scale };
}

/** Whether a map reaching `extent` CSS pixels in from the right edge of a
 * container `width` wide leaves a gap to the chrome centred on its bottom edge. */
export function minimapRoom(width: number, chrome: ChromeBoxes, extent: number): boolean {
  let centred = 0;
  for (const entry of chrome.values()) {
    if (entry.kind === "screen" && entry.place === "bottom") {
      centred = Math.max(centred, entry.width);
    }
  }
  return (width - centred) / 2 >= extent + CHROME_GAP;
}
