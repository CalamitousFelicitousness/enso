import type Konva from "konva";
import { scaleRange, zoomAbout } from "@/lib/viewport/camera";
import { WHEEL_SETTLE_MS, type HitClass } from "@/lib/viewport/gestures";
import { applyPinch, type PinchStep } from "@/lib/viewport/pinch";
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

export interface CameraOptions {
  /** Runs at the start of each gesture and each wheel sequence. */
  onGesture?: () => void;
  /** Gestures move nothing while this returns false. */
  canGesture?: () => boolean;
}

/** A Konva name for click targets that open the file picker. */
export const PICKER_NAME = "picker";

/**
 * One canvas's view. The store's viewport is the committed camera, which the
 * positioned chrome renders from; `live` runs ahead of it during a gesture,
 * and the bus carries it to the stage, the background and the overlay.
 */
export interface Camera {
  bus: ViewportBus;
  /** The measured chrome this canvas's fits keep in view or clear of. */
  chrome: ChromeRegistry;
  /** The Stage's ref: a stage it has not seen gets the live camera at once. */
  attach: (stage: Konva.Stage | null) => void;
  stage: () => Konva.Stage | null;
  /** The container size; a zero dimension keeps the last real one. */
  measure: (size: Size) => void;
  container: () => Size | null;
  /** The stage scale of one image pixel per CSS pixel; the zoom limits follow it. */
  setUnit: (unit: number) => void;
  live: () => Viewport;
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
  /** What the drawn canvas holds under a container point. */
  hitAt: (point: Point) => HitClass;
  /** Space is held: a left press pans and the mask brush stays off. */
  panKeyHeld: { current: boolean };
  /** Stops Konva's drags and transforms with nothing saved, then tells the
   * tools that keep a gesture of their own. */
  interrupt: () => void;
  onInterrupt: (cb: () => void) => () => void;
  onGesture: () => void;
  canGesture: () => boolean;
}

const sameViewport = (a: Viewport, b: Viewport) =>
  a.x === b.x && a.y === b.y && a.scale === b.scale;

export function createCamera(store: CameraStore, options: CameraOptions = {}): Camera {
  const bus = createViewportBus();
  const interrupts = new Set<() => void>();
  let stage: Konva.Stage | null = null;
  let size: Size | null = null;
  let unit = 1;
  let live = store.getState().viewport;
  let frame: number | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  const draw = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
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
    if (frame !== null) draw();
    if (!sameViewport(store.getState().viewport, live)) store.getState().setViewport(live);
  };

  const apply = (vp: Viewport) => {
    live = vp;
    frame ??= requestAnimationFrame(() => {
      frame = null;
      draw();
    });
  };

  // A write that did not come from this camera (a fit) lands at once, in the
  // frame React renders the chrome for it
  store.subscribe((state, prev) => {
    if (state.viewport === prev.viewport || sameViewport(state.viewport, live)) return;
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
      size = next;
      stage?.size(next);
      draw();
    },
    container: () => size,
    setUnit: (next) => {
      unit = next;
    },
    live: () => live,
    committed: () => store.getState().viewport,
    subscribe: (cb) =>
      store.subscribe((state, prev) => {
        if (state.viewport !== prev.viewport) cb(state.viewport);
      }),
    apply,
    commit,
    settle: () => {
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = setTimeout(commit, WHEEL_SETTLE_MS);
    },
    set: (vp) => {
      live = vp;
      draw();
      commit();
    },
    panBy: (dx, dy) => apply({ x: live.x + dx, y: live.y + dy, scale: live.scale }),
    zoomAt: (point, factor) => apply(zoomAbout(live, point, factor, scaleRange(unit))),
    pinch: (step) => apply(applyPinch(live, step, scaleRange(unit))),
    hitAt: (point) => {
      if (!stage) return "none";
      // The hit graph is drawn with the stage; a pending frame would answer
      // for the camera before the last move
      if (frame !== null) draw();
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
    onGesture: () => options.onGesture?.(),
    canGesture: () => options.canGesture?.() ?? true,
  };
}
