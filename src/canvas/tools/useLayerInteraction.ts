import { useCallback } from "react";
import { useCanvasStore, type ImageLayer } from "@/stores/canvasStore";
import type Konva from "konva";
import type { useSnap } from "./useSnap";

export type Snap = ReturnType<typeof useSnap>;

/** Select, drag and transform handlers for the per-frame image and mask
 * nodes, shared by the layers that render them. */
export function useLayerInteraction(snap: Snap) {
  const setActiveInputFrame = useCanvasStore((s) => s.setActiveInputFrame);
  const setActiveLayerInFrame = useCanvasStore((s) => s.setActiveLayerInFrame);
  const updateLayerInFrame = useCanvasStore((s) => s.updateLayerInFrame);

  const onLayerClick = useCallback(
    (frameId: string, layerId: string, e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button !== 0 || useCanvasStore.getState().activeTool !== "move") return;
      e.cancelBubble = true;
      setActiveInputFrame(frameId);
      setActiveLayerInFrame(frameId, layerId);
    },
    [setActiveInputFrame, setActiveLayerInFrame],
  );

  const onLayerDragEnd = useCallback(
    (frameId: string, layerId: string, e: Konva.KonvaEventObject<DragEvent>) => {
      snap.clearGuides();
      updateLayerInFrame(frameId, layerId, {
        x: e.target.x(),
        y: e.target.y(),
      } as Partial<ImageLayer>);
    },
    [snap, updateLayerInFrame],
  );

  const onLayerTransformEnd = useCallback(
    (frameId: string, layerId: string, e: Konva.KonvaEventObject<Event>) => {
      snap.clearGuides();
      const node = e.target as Konva.Image;
      updateLayerInFrame(frameId, layerId, {
        x: node.x(),
        y: node.y(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
        rotation: node.rotation(),
      } as Partial<ImageLayer>);
    },
    [snap, updateLayerInFrame],
  );

  return {
    onLayerClick,
    onLayerDragEnd,
    onLayerTransformEnd,
    onLayerDragMove: snap.handleDragMove,
  };
}
