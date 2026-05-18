import { useCallback, useRef } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { bakeMaskStrokes } from "@/lib/bakeMask";
import type { MaskLine } from "@/stores/img2imgStore";
import type { CanvasLayout } from "@/canvas/useControlFrameLayout";
import type Konva from "konva";

interface UseMaskPaintOptions {
  stageRef: React.RefObject<Konva.Stage | null>;
  spaceHeld: React.RefObject<boolean>;
  /** Canvas layout; used to hit-test Initial frames on pointerdown and to
   * project pointer coords into the pinned frame's local pixel space. */
  layout: CanvasLayout;
}

/**
 * Imperative mask painting, per Input frame. On pointerdown the stroke
 * hit-tests `layout.inputFrames`, pins to the first Initial frame the
 * pointer lands inside, and projects subsequent points into that frame's
 * local pixel space. The active <Line> + <Circle> Konva nodes live
 * inside the pinned (= focused) frame's displayScale group, so the
 * stroke renders pixel-for-pixel with what eventually commits to
 * `frame.maskLines`.
 *
 * Pin-on-pointerdown invariant: the pinned frame is captured at stroke
 * start and never re-resolved mid-drag. A stroke that drags off-frame
 * keeps attaching to the original frame.
 */
export function useMaskPaint({ stageRef, spaceHeld, layout }: UseMaskPaintOptions) {
  const isDrawing = useRef(false);
  const pointsBuffer = useRef<number[]>([]);
  const toolRef = useRef<MaskLine["tool"]>("brush");
  const strokeWidthRef = useRef(20);
  const pinnedFrameId = useRef<string | null>(null);

  // Konva node refs - InputFrameLayer attaches the active line + cursor
  // for the focused frame via these callback setters.
  const activeLineRef = useRef<Konva.Line | null>(null);
  const cursorRef = useRef<Konva.Circle | null>(null);

  const setActiveLineNode = useCallback((node: Konva.Line | null) => {
    activeLineRef.current = node;
  }, []);

  const setCursorNode = useCallback((node: Konva.Circle | null) => {
    cursorRef.current = node;
  }, []);

  const hitTestInitialFrame = useCallback(
    (stage: Konva.Stage): { frameId: string; x: number; y: number } | null => {
      const pointer = stage.getPointerPosition();
      if (!pointer) return null;
      const stx = (pointer.x - stage.x()) / stage.scaleX();
      const sty = (pointer.y - stage.y()) / stage.scaleY();
      for (const f of layout.inputFrames) {
        if (f.kind !== "initial") continue;
        if (stx >= f.x && stx < f.x + f.displayW && sty >= f.y && sty < f.y + f.displayH) {
          const ds = layout.displayScale;
          return {
            frameId: f.frameId,
            x: (stx - f.x) / ds,
            y: (sty - f.y) / ds,
          };
        }
      }
      return null;
    },
    [layout],
  );

  const projectToPinnedFrame = useCallback(
    (stage: Konva.Stage): { x: number; y: number } | null => {
      const pinId = pinnedFrameId.current;
      if (!pinId) return null;
      const pinned = layout.inputFrames.find((f) => f.kind === "initial" && f.frameId === pinId);
      if (!pinned || pinned.kind !== "initial") return null;
      const pointer = stage.getPointerPosition();
      if (!pointer) return null;
      const stx = (pointer.x - stage.x()) / stage.scaleX();
      const sty = (pointer.y - stage.y()) / stage.scaleY();
      const ds = layout.displayScale;
      return {
        x: (stx - pinned.x) / ds,
        y: (sty - pinned.y) / ds,
      };
    },
    [layout],
  );

  const projectToFocusedFrame = useCallback(
    (stage: Konva.Stage): { x: number; y: number } | null => {
      const focusedId = useCanvasStore.getState().activeInputFrameId;
      let targetId: string | null = focusedId;
      if (!targetId) {
        const firstInitial = layout.inputFrames.find((f) => f.kind === "initial");
        if (firstInitial) targetId = firstInitial.frameId;
      }
      if (!targetId) return null;
      const target = layout.inputFrames.find((f) => f.kind === "initial" && f.frameId === targetId);
      if (!target || target.kind !== "initial") return null;
      const pointer = stage.getPointerPosition();
      if (!pointer) return null;
      const stx = (pointer.x - stage.x()) / stage.scaleX();
      const sty = (pointer.y - stage.y()) / stage.scaleY();
      const ds = layout.displayScale;
      return {
        x: (stx - target.x) / ds,
        y: (sty - target.y) / ds,
      };
    },
    [layout],
  );

  const isMaskTool = useCallback(() => {
    const tool = useCanvasStore.getState().activeTool;
    return tool === "maskBrush" || tool === "maskEraser";
  }, []);

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isMaskTool() || e.evt.button !== 0 || spaceHeld.current) return;
      const stage = stageRef.current;
      if (!stage) return;
      const hit = hitTestInitialFrame(stage);
      if (!hit) return;

      const { activeTool, brushSize, setActiveInputFrame } = useCanvasStore.getState();
      pinnedFrameId.current = hit.frameId;
      setActiveInputFrame(hit.frameId);
      toolRef.current = activeTool === "maskEraser" ? "eraser" : "brush";
      strokeWidthRef.current = brushSize;
      pointsBuffer.current = [hit.x, hit.y];
      isDrawing.current = true;

      const line = activeLineRef.current;
      if (line) {
        line.points([hit.x, hit.y]);
        line.strokeWidth(brushSize);
        line.globalCompositeOperation(
          toolRef.current === "eraser" ? "destination-out" : "source-over",
        );
        line.visible(true);
        line.getLayer()?.batchDraw();
      }
    },
    [stageRef, spaceHeld, hitTestInitialFrame, isMaskTool],
  );

  const handleMouseMove = useCallback(
    (_e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = stageRef.current;
      if (!stage) return;

      if (isMaskTool()) {
        const pos = isDrawing.current ? projectToPinnedFrame(stage) : projectToFocusedFrame(stage);
        const cursor = cursorRef.current;
        if (cursor && pos) {
          const combinedScale = stage.scaleX() * layout.displayScale;
          cursor.x(pos.x);
          cursor.y(pos.y);
          cursor.radius(useCanvasStore.getState().brushSize / 2);
          cursor.strokeWidth(1 / combinedScale);
          cursor.dash([4 / combinedScale, 4 / combinedScale]);
          cursor.visible(true);
        } else if (cursor) {
          cursor.visible(false);
        }
        stage.container().style.cursor = "none";

        if (!isDrawing.current) {
          cursor?.getLayer()?.batchDraw();
        }
      } else {
        const cursor = cursorRef.current;
        if (cursor?.visible()) {
          cursor.visible(false);
          cursor.getLayer()?.batchDraw();
        }
        if (stage.container().style.cursor === "none") {
          stage.container().style.cursor = "";
        }
      }

      if (!isDrawing.current) return;
      const pos = projectToPinnedFrame(stage);
      if (!pos) return;

      pointsBuffer.current.push(pos.x, pos.y);

      const line = activeLineRef.current;
      if (line) {
        line.points(pointsBuffer.current);
        line.getLayer()?.batchDraw();
      }
    },
    [stageRef, isMaskTool, projectToPinnedFrame, projectToFocusedFrame, layout],
  );

  const commitLine = useCallback(() => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const frameId = pinnedFrameId.current;
    pinnedFrameId.current = null;

    if (frameId && pointsBuffer.current.length >= 2) {
      useCanvasStore.getState().addMaskLineToFrame(frameId, {
        points: pointsBuffer.current.slice(),
        strokeWidth: strokeWidthRef.current,
        tool: toolRef.current,
      });
      void bakeMaskStrokes(frameId);
    }

    const line = activeLineRef.current;
    if (line) {
      line.visible(false);
      line.getLayer()?.batchDraw();
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    commitLine();
  }, [commitLine]);

  const handleMouseLeave = useCallback(() => {
    const cursor = cursorRef.current;
    if (cursor) {
      cursor.visible(false);
      cursor.getLayer()?.batchDraw();
    }
    commitLine();
  }, [commitLine]);

  return {
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseUp: handleMouseUp,
    onMouseLeave: handleMouseLeave,
    setActiveLineNode,
    setCursorNode,
  };
}
