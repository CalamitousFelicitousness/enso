import { useEffect, type RefObject } from "react";
import Konva from "konva";
import {
  IDLE_GESTURES,
  gestureStep,
  surfaceCursor,
  type FocusClass,
  type GestureEffect,
  type GestureEnv,
  type GestureInput,
  type HitClass,
  type PointerKind,
  type SurfaceTool,
  type TargetClass,
} from "@/lib/viewport/gestures";
import type { Point } from "@/lib/viewport/types";
import { useUiStore } from "@/stores/uiStore";
import { setPanKey } from "../konvaSetup";
import type { Camera } from "./camera";

interface ViewportGestureOptions {
  /** The clipped element over the stage and its chrome. */
  surfaceRef: RefObject<HTMLElement | null>;
  camera: Camera;
  /** Read at event time. */
  tool: () => SurfaceTool;
  /** Listeners bind only while the canvas is on screen. */
  enabled: boolean;
}

function kindOf(e: PointerEvent): PointerKind {
  return e.pointerType === "touch" ? "touch" : e.pointerType === "pen" ? "pen" : "mouse";
}

function editable(el: Element): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

/**
 * Pan and zoom by wheel, pinch, middle drag, Space drag and a left drag on
 * empty canvas. Native listeners on the surface: React's wheel listener is
 * passive, and the surface must see an event before the chrome's own
 * handlers decide on it.
 */
export function useViewportGestures({ surfaceRef, camera, tool, enabled }: ViewportGestureOptions) {
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!enabled || !surface) return;

    let state = IDLE_GESTURES;
    let hover: HitClass | null = null;
    let cursor: string | null = null;
    let preventMouseDown = false;
    let withholding = false;
    let captor: HTMLElement | null = null;

    const env = (): GestureEnv => ({
      tool: tool(),
      wheelMode: useUiStore.getState().canvasWheel,
    });

    // The stage container's corner is the camera's origin
    const pointOf = (e: { clientX: number; clientY: number }): Point => {
      const rect = (camera.stage()?.container() ?? surface).getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const targetOf = (e: Event): TargetClass => {
      const content = camera.stage()?.content;
      return content && e.target instanceof Node && content.contains(e.target)
        ? "content"
        : "chrome";
    };

    const focusOf = (): FocusClass => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return "canvas";
      if (editable(el) || !surface.contains(el)) return "other";
      return el === surface || camera.stage()?.container().contains(el) ? "canvas" : "chrome";
    };

    const syncCursor = () => {
      const el = camera.stage()?.container();
      if (!el) return;
      const want = surfaceCursor(state, env(), hover);
      if (want === null) {
        // Hand the cursor back to the tool that owns it
        if (cursor !== null && el.style.cursor === cursor) el.style.cursor = "";
        cursor = null;
        return;
      }
      if (el.style.cursor !== want) el.style.cursor = want;
      cursor = want;
    };

    const syncPanKey = () => {
      const held = state.space === "armed";
      if (camera.panKeyHeld.current === held) return;
      camera.panKeyHeld.current = held;
      setPanKey(held);
    };

    const run = (effect: GestureEffect, e: Event | null) => {
      switch (effect.type) {
        // The browser draws the cursor of the element holding the capture, so
        // it is the stage container, whose cursor syncCursor sets
        case "capture":
          captor = camera.stage()?.container() ?? surface;
          captor.setPointerCapture(effect.pointerId);
          break;
        case "release":
          if (captor?.hasPointerCapture(effect.pointerId)) {
            captor.releasePointerCapture(effect.pointerId);
          }
          break;
        case "pan":
          camera.panBy(effect.dx, effect.dy);
          break;
        case "zoom":
          camera.zoomAt(effect.point, effect.factor);
          break;
        case "pinch":
          camera.pinch(effect.step);
          break;
        case "start":
          camera.onGesture();
          break;
        case "commit":
          camera.commit();
          break;
        case "settle":
          camera.settle();
          break;
        case "prevent":
          e?.preventDefault();
          break;
        case "preventMouseDown":
          preventMouseDown = true;
          break;
        case "interrupt":
          camera.interrupt();
          break;
        case "clearClick":
          Konva._mouseListenClick = false;
          Konva._touchListenClick = false;
          Konva._pointerListenClick = false;
          Konva.DD.justDragged = true;
          break;
        case "withholdTouch":
          withholding = true;
          break;
      }
    };

    const step = (input: GestureInput, e: Event | null) => {
      const before = state.drag.kind;
      const result = gestureStep(state, input, env());
      state = result.state;
      for (const effect of result.effects) run(effect, e);
      // The hover read before a pan is stale once it ends
      if (before === "pan" && state.drag.kind !== "pan") hover = null;
      syncPanKey();
      syncCursor();
    };

    const onPointerDown = (e: PointerEvent) => {
      preventMouseDown = false;
      const point = pointOf(e);
      const target = targetOf(e);
      const hit = target === "content" && e.button === 0 ? camera.hitAt(point) : "none";
      step(
        {
          type: "down",
          pointerId: e.pointerId,
          kind: kindOf(e),
          button: e.button,
          point,
          target,
          hit,
        },
        e,
      );
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!preventMouseDown) return;
      preventMouseDown = false;
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      const kind = kindOf(e);
      if (state.drag.kind === "idle" && kind !== "touch" && e.buttons === 0) {
        hover = targetOf(e) === "content" ? camera.hitAt(pointOf(e)) : null;
      }
      step({ type: "move", pointerId: e.pointerId, kind, point: pointOf(e) }, e);
    };

    const onPointerUp = (e: PointerEvent) => {
      step({ type: "up", pointerId: e.pointerId, kind: kindOf(e) }, e);
    };

    const onPointerCancel = (e: PointerEvent) => {
      step({ type: "cancel", pointerId: e.pointerId, kind: kindOf(e) }, e);
    };

    // Only the capture taken here: a touch starts captured to the Konva
    // canvas, which loses it (and says so, bubbling) when the pan takes it
    const onLostCapture = (e: PointerEvent) => {
      if (e.target === captor) onPointerCancel(e);
    };

    const onPointerLeave = () => {
      if (state.drag.kind !== "idle") return;
      hover = null;
      syncCursor();
    };

    const onWheel = (e: WheelEvent) => {
      const container = camera.container() ?? {
        width: surface.clientWidth,
        height: surface.clientHeight,
      };
      step(
        {
          type: "wheel",
          time: e.timeStamp,
          wheel: e,
          defaultPrevented: e.defaultPrevented,
          target: targetOf(e),
          point: pointOf(e),
          container,
        },
        e,
      );
    };

    // Pointer capture does not retarget touch events, so Konva would still
    // start node drags and taps from a touch the surface owns
    const onTouch = (e: TouchEvent) => {
      if (!withholding) return;
      e.stopPropagation();
      if ((e.type === "touchend" || e.type === "touchcancel") && e.touches.length === 0) {
        withholding = false;
      }
    };

    // Safari's own pinch events; the pinch itself arrives as a Ctrl wheel
    const onGesture = (e: Event) => e.preventDefault();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.ctrlKey || e.metaKey || e.altKey) return;
      step({ type: "spaceDown", focus: focusOf() }, e);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") step({ type: "spaceUp" }, e);
    };

    const onBlur = () => step({ type: "blur" }, null);
    const closeWheel = camera.onCommand(() => step({ type: "closeWheel" }, null));

    const touchOptions = { capture: true };
    surface.addEventListener("pointerdown", onPointerDown);
    surface.addEventListener("mousedown", onMouseDown, { capture: true });
    surface.addEventListener("pointermove", onPointerMove);
    surface.addEventListener("pointerleave", onPointerLeave);
    surface.addEventListener("lostpointercapture", onLostCapture);
    surface.addEventListener("wheel", onWheel, { passive: false });
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const) {
      surface.addEventListener(type, onTouch, touchOptions);
    }
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
      surface.addEventListener(type, onGesture);
    }
    // A release off the surface still ends a press that never became a pan
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("mousedown", onMouseDown, { capture: true });
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerleave", onPointerLeave);
      surface.removeEventListener("lostpointercapture", onLostCapture);
      surface.removeEventListener("wheel", onWheel);
      for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const) {
        surface.removeEventListener(type, onTouch, touchOptions);
      }
      for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
        surface.removeEventListener(type, onGesture);
      }
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      closeWheel();
      // Hidden mid-gesture: end it, and leave no key held for the next view
      hover = null;
      step({ type: "blur" }, null);
    };
  }, [surfaceRef, camera, tool, enabled]);
}
