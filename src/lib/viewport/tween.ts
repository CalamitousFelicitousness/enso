// Animated camera moves: the scale in log space, the world point under the
// container's centre on a straight line, eased out.

import { screenToWorld } from "./camera";
import type { Size, Viewport } from "./types";

/** `fit`: Show all and the frame fits; `reveal`: a frame brought into view;
 * `step`: a move to the next frame; `key`: a zoom or pan key. */
export type TweenKind = "fit" | "reveal" | "step" | "key";

const DURATION_MS: Record<TweenKind, number> = { fit: 200, reveal: 200, step: 160, key: 120 };

/** Zero under reduced motion: the move lands at once. */
export function tweenDuration(kind: TweenKind, reduced: boolean): number {
  return reduced ? 0 : DURATION_MS[kind];
}

export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/** The view `t` of the way from `a` to `b`; `a` at 0 and `b` at 1, exactly. */
export function interpolateViewport(
  a: Viewport,
  b: Viewport,
  t: number,
  container: Size,
): Viewport {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const centre = { x: container.width / 2, y: container.height / 2 };
  const from = screenToWorld(a, centre);
  const to = screenToWorld(b, centre);
  const scale = Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * t);
  const world = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  return { x: centre.x - world.x * scale, y: centre.y - world.y * scale, scale };
}

export interface Tween {
  from: Viewport;
  start: number;
  duration: number;
}

/** The view at `now` toward `target`, which the caller resolves afresh each
 * frame, so a target that moves mid-tween is where the tween lands. */
export function tweenStep(
  tween: Tween,
  now: number,
  target: Viewport,
  container: Size,
): { vp: Viewport; done: boolean } {
  const t = tween.duration > 0 ? (now - tween.start) / tween.duration : 1;
  if (t >= 1) return { vp: target, done: true };
  return {
    vp: interpolateViewport(tween.from, target, easeOutCubic(Math.max(0, t)), container),
    done: false,
  };
}
