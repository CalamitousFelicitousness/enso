import { useCallback } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import { removePicture } from "@/inputs/edits";
import { useShortcut } from "@/hooks/useShortcut";
import type Konva from "konva";
import { OUTPUT_NAME } from "../layers/OutputLayer";

/** Stage-level layer selection: a click on empty canvas deselects, and the
 * delete shortcuts remove the selected layer while the canvas is on screen. */
export function useImageTransform(stageRef: React.RefObject<Konva.Stage | null>, visible: boolean) {
  const onStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (useCanvasStore.getState().activeTool !== "move") return;
      const empty = e.target === stageRef.current || e.target.hasName(OUTPUT_NAME);
      if (empty) useInputStore.getState().setActiveItem(null);
    },
    [stageRef],
  );

  // A picture goes through edits, which keeps it in the trash; a mask object does not
  const deleteLayer = useCallback(() => {
    if (useCanvasStore.getState().activeTool !== "move") return;
    const { activeItem, frames, removeItem } = useInputStore.getState();
    if (!activeItem) return;
    const frame = frames.find((f) => f.id === activeItem.frameId);
    if (frame?.pictures.some((p) => p.id === activeItem.id)) {
      removePicture(activeItem.frameId, activeItem.id);
    } else {
      removeItem(activeItem.frameId, activeItem.id);
    }
  }, []);

  useShortcut("canvas-delete", deleteLayer, visible);
  useShortcut("canvas-delete-backspace", deleteLayer, visible);

  return { onStageClick };
}
