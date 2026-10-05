import { useCallback } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import { useShortcut } from "@/hooks/useShortcut";
import type Konva from "konva";

/** Stage-level layer selection: a click on empty canvas deselects, and the
 * delete shortcuts remove the selected layer. */
export function useImageTransform(stageRef: React.RefObject<Konva.Stage | null>) {
  const onStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (useCanvasStore.getState().activeTool !== "move") return;
      if (e.target === stageRef.current) useInputStore.getState().setActiveItem(null);
    },
    [stageRef],
  );

  const deleteLayer = useCallback(() => {
    if (useCanvasStore.getState().activeTool !== "move") return;
    const { activeItem, removeItem } = useInputStore.getState();
    if (activeItem) removeItem(activeItem.frameId, activeItem.id);
  }, []);

  useShortcut("canvas-delete", deleteLayer);
  useShortcut("canvas-delete-backspace", deleteLayer);

  return { onStageClick };
}
