import { useCallback, useEffect, useMemo, useRef } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import type Konva from "konva";
import type { useSnap } from "./useSnap";

export type Snap = ReturnType<typeof useSnap>;

/** Select, drag and transform handlers for the per-frame picture and mask
 * nodes, shared by the layers that render them. */
export function useLayerInteraction(snap: Snap) {
  // useSnap hands out a new object every render (its guides are state); the
  // handlers reach it through a ref so they keep their identity.
  const snapRef = useRef(snap);
  useEffect(() => {
    snapRef.current = snap;
  });

  const onLayerClick = useCallback(
    (frameId: string, layerId: string, e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button !== 0 || useCanvasStore.getState().activeTool !== "move") return;
      e.cancelBubble = true;
      const inputs = useInputStore.getState();
      inputs.selectFrame(frameId);
      inputs.setActiveItem({ frameId, id: layerId });
    },
    [],
  );

  const onLayerGestureStart = useCallback((frameId: string) => {
    useCanvasStore.getState().setGestureFrame(frameId);
  }, []);

  const onLayerDragEnd = useCallback(
    (frameId: string, layerId: string, e: Konva.KonvaEventObject<DragEvent>) => {
      snapRef.current.clearGuides();
      useInputStore.getState().patchTransform(frameId, layerId, {
        x: e.target.x(),
        y: e.target.y(),
      });
      useCanvasStore.getState().setGestureFrame(null);
    },
    [],
  );

  const onLayerTransformEnd = useCallback(
    (frameId: string, layerId: string, e: Konva.KonvaEventObject<Event>) => {
      snapRef.current.clearGuides();
      const node = e.target as Konva.Image;
      useInputStore.getState().patchTransform(frameId, layerId, {
        x: node.x(),
        y: node.y(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
        rotation: node.rotation(),
      });
      useCanvasStore.getState().setGestureFrame(null);
    },
    [],
  );

  const onLayerDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => snapRef.current.handleDragMove(e),
    [],
  );

  return useMemo(
    () => ({
      onLayerClick,
      onLayerGestureStart,
      onLayerDragEnd,
      onLayerTransformEnd,
      onLayerDragMove,
    }),
    [onLayerClick, onLayerGestureStart, onLayerDragEnd, onLayerTransformEnd, onLayerDragMove],
  );
}

export type LayerInteraction = ReturnType<typeof useLayerInteraction>;
