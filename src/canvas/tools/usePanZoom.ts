import { useCallback, useEffect, useRef } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { ZOOM_LIMITS } from "@/lib/constants";
import type Konva from "konva";
import type { ViewportBus } from "../viewportBus";

type SetViewportFn = (v: { x?: number; y?: number; scale?: number }) => void;

export function usePanZoom(
  stageRef: React.RefObject<Konva.Stage | null>,
  setViewportOverride?: SetViewportFn,
  bus?: ViewportBus,
) {
  const canvasSetViewport = useCanvasStore((s) => s.setViewport);
  const switchToCanvasMode = useCanvasStore((s) => s.switchToCanvasMode);
  const modeLocked = useCanvasStore((s) => s.modeLocked);
  const setViewport = setViewportOverride ?? canvasSetViewport;
  const isOverride = !!setViewportOverride;
  const spaceHeld = useRef(false);
  const isPanning = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const wheelSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (wheelSyncTimer.current) clearTimeout(wheelSyncTimer.current);
    };
  }, []);

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    if (!isOverride && modeLocked) return;
    if (!isOverride) switchToCanvasMode();
    const stage = stageRef.current;
    if (!stage) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const oldScale = stage.scaleX();
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const factor = 1.1;
    const newScale = Math.min(
      ZOOM_LIMITS.max,
      Math.max(ZOOM_LIMITS.min, direction > 0 ? oldScale * factor : oldScale / factor),
    );

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const newX = pointer.x - mousePointTo.x * newScale;
    const newY = pointer.y - mousePointTo.y * newScale;

    // Imperative Konva update — no React re-render
    stage.x(newX);
    stage.y(newY);
    stage.scaleX(newScale);
    stage.scaleY(newScale);
    stage.batchDraw();
    bus?.emit({ x: newX, y: newY, scale: newScale });

    // Debounced store sync
    if (wheelSyncTimer.current) clearTimeout(wheelSyncTimer.current);
    wheelSyncTimer.current = setTimeout(() => {
      const s = stageRef.current;
      if (s) {
        const vp = { x: s.x(), y: s.y(), scale: s.scaleX() };
        setViewport(vp);
        bus?.emit(vp);
      }
    }, 150);
  }, [stageRef, setViewport, isOverride, modeLocked, switchToCanvasMode, bus]);

  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    // Middle-click or space+left-click to pan
    if (e.evt.button === 1 || (spaceHeld.current && e.evt.button === 0)) {
      e.evt.preventDefault();
      if (!isOverride && modeLocked) return;
      if (!isOverride) switchToCanvasMode();
      isPanning.current = true;
      lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };
      const stage = stageRef.current;
      if (stage) {
        const container = stage.container();
        container.style.cursor = "grabbing";
      }
    }
  }, [stageRef, isOverride, modeLocked, switchToCanvasMode]);

  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!isPanning.current) return;
    const stage = stageRef.current;
    if (!stage) return;

    const dx = e.evt.clientX - lastPointer.current.x;
    const dy = e.evt.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };

    const newX = stage.x() + dx;
    const newY = stage.y() + dy;

    // Imperative Konva update — no React re-render
    stage.x(newX);
    stage.y(newY);
    stage.batchDraw();
    bus?.emit({ x: newX, y: newY, scale: stage.scaleX() });
  }, [stageRef, bus]);

  const handleMouseUp = useCallback(() => {
    if (isPanning.current) {
      isPanning.current = false;
      const stage = stageRef.current;
      if (stage) {
        const container = stage.container();
        container.style.cursor = spaceHeld.current ? "grab" : "default";
        // Sync to store on gesture end
        const vp = { x: stage.x(), y: stage.y(), scale: stage.scaleX() };
        setViewport(vp);
        bus?.emit(vp);
      }
    }
  }, [stageRef, setViewport, bus]);

  // Space key tracking for pan mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        spaceHeld.current = true;
        const stage = stageRef.current;
        if (stage) stage.container().style.cursor = "grab";
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeld.current = false;
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
  }, [stageRef]);

  return {
    onWheel: handleWheel,
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseUp: handleMouseUp,
    spaceHeld,
  };
}
