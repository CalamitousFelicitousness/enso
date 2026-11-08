import type Konva from "konva";
import {
  FIT_MAX_SCALE,
  centerOn,
  containsBox,
  fitBoxBest,
  ladderStep,
  reframe,
  sameViewport,
  scaleRange,
  zoomAbout,
  zoomPercent,
  zoomTo,
} from "@/lib/viewport/camera";
import { WHEEL_SETTLE_MS, type HitClass } from "@/lib/viewport/gestures";
import type { FitTargets } from "@/lib/viewport/insets";
import { applyPinch, type PinchStep } from "@/lib/viewport/pinch";
import { tweenDuration, tweenStep, type Tween, type TweenKind } from "@/lib/viewport/tween";
import type { Point, Size, Viewport } from "@/lib/viewport/types";
import { createViewportBus, type ViewportBus } from "../viewportBus";
import { createChromeRegistry, type ChromeRegistry } from "./chrome";
import { stopKonvaGestures } from "./interrupt";

/** The slice of a canvas store the camera touches. */
export interface CameraStore {
  getState: () => {
    viewport: Viewport;
    setViewport: (v: Partial<Viewport>) => void;
  };
  subscribe: (
    listener: (state: { viewport: Viewport }, prev: { viewport: Viewport }) => void,
  ) => () => void;
}

/** What the camera keeps fitted as the content and the container change:
 * every frame, the current frame, or nothing (the view stays where it was
 * moved). */
export type Follow = "all" | "frame" | null;

/** A Konva name for click targets that open the file picker. */
export const PICKER_NAME = "picker";

/**
 * One canvas's view. The store's viewport is the committed camera, which the
 * positioned chrome renders from; `live` runs ahead of it during a gesture or
 * a move, and the bus carries it to the stage, the background and the overlay.
 */
export interface Camera {
  bus: ViewportBus;
  /** The measured chrome this canvas's fits keep in view or clear of. */
  chrome: ChromeRegistry;
  /** The Stage's ref: a stage it has not seen gets the live camera at once. */
  attach: (stage: Konva.Stage | null) => void;
  stage: () => Konva.Stage | null;
  /** The container size; a zero dimension keeps the last real one. A resize
   * refits what the camera follows, or keeps the centre. */
  measure: (size: Size) => void;
  container: () => Size | null;
  /** The stage scale of one image pixel per CSS pixel; the zoom limits follow it. */
  setUnit: (unit: number) => void;
  unit: () => number;
  /** The frames and chrome the fits read, and the frame `frame` follows. */
  setTargets: (targets: FitTargets, current: string) => void;
  following: () => Follow;
  subscribeFollow: (cb: (follow: Follow) => void) => () => void;
  /** The stored state is in: fit what `follow` names at once, and animate
   * every later refit. Before this, refits land at once. */
  arm: (follow: Follow) => void;
  live: () => Viewport;
  /** Where the camera is headed: a move's end, else the live view. */
  target: () => Viewport;
  committed: () => Viewport;
  /** Committed changes only: fits, gesture ends, settled wheels. */
  subscribe: (cb: (vp: Viewport) => void) => () => void;
  apply: (vp: Viewport) => void;
  commit: () => void;
  /** Commits once the wheel has been quiet. */
  settle: () => void;
  set: (vp: Viewport) => void;
  panBy: (dx: number, dy: number) => void;
  zoomAt: (point: Point, factor: number) => void;
  pinch: (step: PinchStep) => void;
  showAll: () => void;
  fitFrame: () => void;
  /** One step along the zoom ladder about the container's centre. */
  zoomStep: (direction: 1 | -1) => void;
  canZoom: (direction: 1 | -1) => boolean;
  /** One image pixel per CSS pixel, about the container's centre. */
  zoomToUnit: () => void;
  /** Pan by fractions of the container. */
  panStep: (fx: number, fy: number) => void;
  /** Centre a frame that is not wholly in view, at the same zoom. */
  reveal: (id: string, kind: Extract<TweenKind, "reveal" | "step">) => void;
  /** A command took over: the gestures close the running wheel sequence. */
  onCommand: (cb: () => void) => () => void;
  /** What the drawn canvas holds under a container point. */
  hitAt: (point: Point) => HitClass;
  /** Space is held: a left press pans and the mask brush stays off. */
  panKeyHeld: { current: boolean };
  /** Stops Konva's drags and transforms with nothing saved, then tells the
   * tools that keep a gesture of their own. */
  interrupt: () => void;
  onInterrupt: (cb: () => void) => () => void;
  /** A gesture or a wheel sequence began: the view no longer follows. */
  onGesture: () => void;
}

interface Move extends Tween {
  resolve: (container: Size) => Viewport | null;
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function createCamera(store: CameraStore): Camera {
  const bus = createViewportBus();
  const interrupts = new Set<() => void>();
  const commands = new Set<() => void>();
  const followers = new Set<(follow: Follow) => void>();
  let stage: Konva.Stage | null = null;
  let size: Size | null = null;
  let unit = 1;
  let live = store.getState().viewport;
  let frame: number | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let targets: FitTargets | null = null;
  let current = "output";
  let follow: Follow = "all";
  let armed = false;
  let move: Move | null = null;

  const fit = (kind: Exclude<Follow, null>, container: Size): Viewport | null => {
    if (!targets) return null;
    const box = kind === "all" ? targets.all : (targets.frame(current) ?? targets.frame("output"));
    return box ? fitBoxBest(box, container, targets.insets, FIT_MAX_SCALE) : null;
  };
  // One resolver for whatever is followed, so a running fit picks up a change
  // of the content, the container or the follow itself
  const followed = (container: Size) => (follow ? fit(follow, container) : null);

  const setFollow = (next: Follow) => {
    if (next === follow) return;
    follow = next;
    followers.forEach((cb) => cb(next));
  };

  const draw = () => {
    if (stage) {
      stage.setAttrs({ x: live.x, y: live.y, scaleX: live.scale, scaleY: live.scale });
      stage.draw();
    }
    bus.emit(live, size ?? { width: 0, height: 0 });
  };

  const commit = () => {
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    flush();
    if (!sameViewport(store.getState().viewport, live)) store.getState().setViewport(live);
  };

  const tick = (now: number) => {
    frame = null;
    if (move && size) {
      const target = move.resolve(size);
      if (target) {
        const step = tweenStep(move, now, target, size);
        live = step.vp;
        if (step.done) move = null;
      } else {
        move = null;
      }
      draw();
      if (move) frame = requestAnimationFrame(tick);
      else commit();
      return;
    }
    draw();
  };

  const schedule = () => {
    frame ??= requestAnimationFrame(tick);
  };

  // Runs the pending frame now: what is drawn, hit-tested or committed is the
  // camera after the last change
  function flush() {
    if (frame === null) return;
    cancelAnimationFrame(frame);
    tick(performance.now());
  }

  const set = (vp: Viewport) => {
    move = null;
    live = vp;
    draw();
    commit();
  };

  /** Move to what `resolve` answers: animated once armed, else at once. */
  const go = (resolve: Move["resolve"], kind: TweenKind) => {
    if (!size) return;
    const duration = armed && !document.hidden ? tweenDuration(kind, reducedMotion()) : 0;
    if (duration === 0) {
      const vp = resolve(size);
      if (vp) set(vp);
      return;
    }
    move = { from: live, start: performance.now(), duration, resolve };
    schedule();
  };

  const target = (): Viewport => (move && size ? (move.resolve(size) ?? live) : live);

  /** A move the user asked for: it ends a running wheel sequence. */
  const command = (resolve: Move["resolve"], kind: TweenKind) => {
    commands.forEach((cb) => cb());
    go(resolve, kind);
  };

  const fixed = (vp: Viewport) => () => vp;

  const centre = (container: Size): Point => ({
    x: container.width / 2,
    y: container.height / 2,
  });

  /** The gestures move the live view directly; a move under way stops. */
  const gesture = (vp: Viewport) => {
    move = null;
    live = vp;
    schedule();
  };

  // A write that did not come from this camera lands at once, in the frame
  // React renders the chrome for it
  store.subscribe((state, prev) => {
    if (state.viewport === prev.viewport || sameViewport(state.viewport, live)) return;
    move = null;
    live = state.viewport;
    draw();
  });

  return {
    bus,
    chrome: createChromeRegistry(),
    attach: (next) => {
      if (next === stage) return;
      stage = next;
      if (stage) draw();
    },
    stage: () => stage,
    measure: (next) => {
      if (next.width <= 0 || next.height <= 0) return;
      if (size && size.width === next.width && size.height === next.height) return;
      const before = size;
      size = next;
      stage?.size(next);
      // A move under way resolves against the new size on its next frame
      if (!move) {
        const followedFit = followed(next);
        if (followedFit) {
          live = followedFit;
        } else if (!follow && before && targets) {
          const all = targets.all;
          const kept = reframe(live, { container: before, all }, { container: next, all });
          if (kept === "all") {
            setFollow("all");
            live = fit("all", next) ?? live;
          } else {
            live = kept;
          }
        }
      }
      draw();
      // The resize settles before the docks re-render at the new view
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = setTimeout(commit, WHEEL_SETTLE_MS);
    },
    container: () => size,
    setUnit: (next) => {
      if (next === unit) return;
      unit = next;
      bus.emit(live, size ?? { width: 0, height: 0 });
    },
    unit: () => unit,
    setTargets: (next, nextCurrent) => {
      const before = targets;
      targets = next;
      current = nextCurrent;
      if (!size) return;
      if (follow) {
        if (move?.resolve === followed) return;
        const vp = followed(size);
        if (vp && !sameViewport(vp, target())) go(followed, "fit");
        return;
      }
      if (move || !before) return;
      const all = { container: size, all: before.all };
      if (reframe(live, all, { container: size, all: next.all }) === "all") {
        setFollow("all");
        go(followed, "fit");
      }
    },
    following: () => follow,
    subscribeFollow: (cb) => {
      followers.add(cb);
      return () => {
        followers.delete(cb);
      };
    },
    arm: (next) => {
      if (armed) return;
      setFollow(next);
      const vp = size ? followed(size) : null;
      if (vp) set(vp);
      armed = true;
    },
    live: () => live,
    target,
    committed: () => store.getState().viewport,
    subscribe: (cb) =>
      store.subscribe((state, prev) => {
        if (state.viewport !== prev.viewport) cb(state.viewport);
      }),
    apply: gesture,
    commit,
    settle: () => {
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = setTimeout(commit, WHEEL_SETTLE_MS);
    },
    set,
    panBy: (dx, dy) => gesture({ x: live.x + dx, y: live.y + dy, scale: live.scale }),
    zoomAt: (point, factor) => gesture(zoomAbout(live, point, factor, scaleRange(unit))),
    pinch: (step) => gesture(applyPinch(live, step, scaleRange(unit))),
    showAll: () => {
      setFollow("all");
      command(followed, "fit");
    },
    fitFrame: () => {
      setFollow("frame");
      command(followed, "fit");
    },
    zoomStep: (direction) => {
      if (!size) return;
      const base = target();
      const percent = ladderStep(zoomPercent(base, unit), direction);
      if (percent === null) return;
      setFollow(null);
      command(fixed(zoomTo(base, centre(size), (percent / 100) * unit)), "key");
    },
    canZoom: (direction) => ladderStep(zoomPercent(target(), unit), direction) !== null,
    zoomToUnit: () => {
      if (!size) return;
      setFollow(null);
      command(fixed(zoomTo(target(), centre(size), unit)), "key");
    },
    panStep: (fx, fy) => {
      if (!size) return;
      const base = target();
      setFollow(null);
      command(
        fixed({ x: base.x + fx * size.width, y: base.y + fy * size.height, scale: base.scale }),
        "key",
      );
    },
    reveal: (id, kind) => {
      const box = targets?.frame(id);
      if (!size || !box) return;
      const base = target();
      if (containsBox(base, size, box)) return;
      setFollow(null);
      const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      command(fixed(centerOn(base, middle, size)), kind);
    },
    onCommand: (cb) => {
      commands.add(cb);
      return () => {
        commands.delete(cb);
      };
    },
    hitAt: (point) => {
      if (!stage) return "none";
      // The hit graph is drawn with the stage
      flush();
      const shape = stage.getIntersection(point);
      if (!shape) return "none";
      for (let node: Konva.Node | null = shape; node && node !== stage; node = node.getParent()) {
        if (node.draggable()) return "draggable";
      }
      return shape.hasName(PICKER_NAME) ? "picker" : "shape";
    },
    panKeyHeld: { current: false },
    interrupt: () => {
      if (stage) stopKonvaGestures(stage);
      interrupts.forEach((cb) => cb());
    },
    onInterrupt: (cb) => {
      interrupts.add(cb);
      return () => {
        interrupts.delete(cb);
      };
    },
    onGesture: () => {
      move = null;
      setFollow(null);
    },
  };
}
