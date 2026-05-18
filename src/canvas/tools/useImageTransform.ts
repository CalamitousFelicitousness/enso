import { useCallback } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useShortcut } from "@/hooks/useShortcut";
import type Konva from "konva";

/** Resolve the focused Initial frame and its active layer id from the
 * current canvasStore snapshot. Used by stage-level interactions
 * (background click, keyboard delete) to know which layer is the
 * Transformer's current target. */
function getFocusedInitialLayer(): { frameId: string; layerId: string | null } | null {
  const { inputFrames, activeInputFrameId } = useCanvasStore.getState();
  const focused = inputFrames.find((f) => f.id === activeInputFrameId) ?? inputFrames[0];
  if (!focused || focused.mode !== "initial") return null;
  return { frameId: focused.id, layerId: focused.activeLayerId };
}

export function useImageTransform(
  stageRef: React.RefObject<Konva.Stage | null>,
  trRef: React.RefObject<Konva.Transformer | null>,
) {
  const onStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (useCanvasStore.getState().activeTool !== "move") return;
      if (e.target === stageRef.current) {
        const focused = getFocusedInitialLayer();
        if (focused) {
          useCanvasStore.getState().setActiveLayerInFrame(focused.frameId, null);
        }
        trRef.current?.nodes([]);
      }
    },
    [stageRef, trRef],
  );

  const deleteLayer = useCallback(() => {
    if (useCanvasStore.getState().activeTool !== "move") return;
    const focused = getFocusedInitialLayer();
    if (focused && focused.layerId) {
      useCanvasStore.getState().removeLayerFromFrame(focused.frameId, focused.layerId);
      trRef.current?.nodes([]);
    }
  }, [trRef]);

  useShortcut("canvas-delete", deleteLayer);
  useShortcut("canvas-delete-backspace", deleteLayer);

  return { onStageClick };
}
