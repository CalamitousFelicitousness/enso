import { useCallback, useEffect, useRef } from "react";
import { scaleRange, zoomAbout } from "@/lib/viewport/camera";
import type Konva from "konva";
import type { ViewportAdapter } from "../viewportAdapter";
import { setPanKey } from "../konvaSetup";

interface PanZoomOptions {
  stageRef: React.RefObject<Konva.Stage | null>;
  viewport: ViewportAdapter;
  /** The stage scale that shows one image pixel per CSS pixel; the zoom limits are relative to it. */
  unitScale: number;
  /** Swallow pan and zoom while it returns false (the images mode lock). */
  canGesture?: () => boolean;
  /** Runs on each pan or zoom event that is allowed through. */
  onGesture?: () => void;
  /** Window listeners bind only while the canvas is on screen. */
  enabled?: boolean;
}

export function usePanZoom({
  stageRef,
  viewport,
  unitScale,
  canGesture,
  onGesture,
  enabled = true,
}: PanZoomOptions) {
  const spaceHeld = useRef(false);
  const isPanning = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const wheelSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (wheelSyncTimer.current) clearTimeout(wheelSyncTimer.current);
    };
  }, []);

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      if (canGesture && !canGesture()) return;
      onGesture?.();
      const stage = stageRef.current;
      if (!stage) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const factor = e.evt.deltaY > 0 ? 1 / 1.1 : 1.1;
      const next = zoomAbout(
        { x: stage.x(), y: stage.y(), scale: stage.scaleX() },
        pointer,
        factor,
        scaleRange(unitScale),
      );

      // Imperative Konva update - no React re-render
      stage.x(next.x);
      stage.y(next.y);
      stage.scaleX(next.scale);
      stage.scaleY(next.scale);
      stage.batchDraw();
      viewport.bus.emit(next);

      // Debounced store sync
      if (wheelSyncTimer.current) clearTimeout(wheelSyncTimer.current);
      wheelSyncTimer.current = setTimeout(() => {
        const s = stageRef.current;
        if (s) {
          const vp = { x: s.x(), y: s.y(), scale: s.scaleX() };
          viewport.setViewport(vp);
          viewport.bus.emit(vp);
        }
      }, 150);
    },
    [stageRef, viewport, unitScale, canGesture, onGesture],
  );

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Middle-click or space+left-click to pan
      if (e.evt.button === 1 || (spaceHeld.current && e.evt.button === 0)) {
        e.evt.preventDefault();
        if (canGesture && !canGesture()) return;
        onGesture?.();
        isPanning.current = true;
        lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };
        const stage = stageRef.current;
        if (stage) {
          const container = stage.container();
          container.style.cursor = "grabbing";
        }
      }
    },
    [stageRef, canGesture, onGesture],
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isPanning.current) return;
      const stage = stageRef.current;
      if (!stage) return;

      const dx = e.evt.clientX - lastPointer.current.x;
      const dy = e.evt.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };

      const newX = stage.x() + dx;
      const newY = stage.y() + dy;

      // Imperative Konva update - no React re-render
      stage.x(newX);
      stage.y(newY);
      stage.batchDraw();
      viewport.bus.emit({ x: newX, y: newY, scale: stage.scaleX() });
    },
    [stageRef, viewport],
  );

  const handleMouseUp = useCallback(() => {
    if (isPanning.current) {
      isPanning.current = false;
      const stage = stageRef.current;
      if (stage) {
        const container = stage.container();
        container.style.cursor = spaceHeld.current ? "grab" : "default";
        // Sync to store on gesture end
        const vp = { x: stage.x(), y: stage.y(), scale: stage.scaleX() };
        viewport.setViewport(vp);
        viewport.bus.emit(vp);
      }
    }
  }, [stageRef, viewport]);

  // A release outside the stage never reaches the Konva handler, which would
  // leave the canvas panning with no button held. The guard above makes the
  // second call a no-op when both fire.
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [enabled, handleMouseUp]);

  // Space key tracking for pan mode
  useEffect(() => {
    if (!enabled) {
      // Nothing else clears these once the listeners are gone, and a latched
      // spaceHeld makes left-drag pan when the canvas comes back.
      spaceHeld.current = false;
      setPanKey(false);
      isPanning.current = false;
      return;
    }
    const revealed = stageRef.current;
    if (revealed) revealed.container().style.cursor = "default";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        spaceHeld.current = true;
        setPanKey(true);
        const stage = stageRef.current;
        if (stage) stage.container().style.cursor = "grab";
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeld.current = false;
        setPanKey(false);
        const stage = stageRef.current;
        if (stage && !isPanning.current) stage.container().style.cursor = "default";
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [enabled, stageRef]);

  return {
    onWheel: handleWheel,
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseUp: handleMouseUp,
    spaceHeld,
  };
}
