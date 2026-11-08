// Zoom and pan for one picture centred in its container (the lightbox and
// the comparison views). The picture scales about its own centre, so the view
// is its scale and its offset from the centred position.

import { clampScale, zoomTo, type ScaleRange } from "./camera";
import type { Point, Size } from "./types";
import { normalizeWheel, wheelIntent, type WheelInput } from "./wheel";

export interface PictureView {
  /** 1 is the picture fitted to the container. */
  scale: number;
  x: number;
  y: number;
}

export const FITTED: PictureView = { scale: 1, x: 0, y: 0 };

/** The view at `scale` that keeps the picture point under `anchor` there;
 * at or below the fitted size the picture recentres. */
export function pictureScaleTo(
  view: PictureView,
  anchor: Point,
  container: Size,
  scale: number,
  range: ScaleRange,
): PictureView {
  const next = clampScale(scale, view.scale, range);
  if (next <= 1) return { scale: next, x: 0, y: 0 };
  const cx = container.width / 2;
  const cy = container.height / 2;
  const vp = zoomTo({ x: cx + view.x, y: cy + view.y, scale: view.scale }, anchor, next);
  return { scale: next, x: vp.x - cx, y: vp.y - cy };
}

/** What a wheel event does: a wheel or a pinch zooms about the pointer,
 * Shift+wheel pans a picture larger than the container; null when nothing moves. */
export function pictureWheel(
  view: PictureView,
  wheel: WheelInput,
  anchor: Point,
  container: Size,
  range: ScaleRange,
): PictureView | null {
  const intent = wheelIntent(normalizeWheel(wheel, container), "zoom");
  if (!intent) return null;
  if (intent.kind === "zoom") {
    const next = pictureScaleTo(view, anchor, container, view.scale * intent.factor, range);
    return next.scale === view.scale && next.x === view.x && next.y === view.y ? null : next;
  }
  if (view.scale <= 1) return null;
  return { ...view, x: view.x + intent.dx, y: view.y + intent.dy };
}
