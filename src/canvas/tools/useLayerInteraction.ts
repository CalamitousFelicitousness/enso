import { useCallback, useEffect, useMemo, useRef } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import type Konva from "konva";
import { interrupting } from "../navigation/interrupt";
import type { useSnap } from "./useSnap";

export type Snap = ReturnType<typeof useSnap>;

/** A drag or transform a pinch interrupted: the node goes back to the
 * placement the document holds. */
function putBack(frameId: string, layerId: string, node: Konva.Node) {
  const frame = useInputStore.getState().frames.find((f) => f.id === frameId);
  const stored =
    frame?.pictures.find((p) => p.id === layerId)?.transform ??
    frame?.mask.objects.find((m) => m.id === layerId)?.transform;
  if (stored) node.setAttrs(stored);
}

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
      if (interrupting()) putBack(frameId, layerId, e.target);
      else {
        useInputStore.getState().patchTransform(frameId, layerId, {
          x: e.target.x(),
          y: e.target.y(),
        });
      }
      useCanvasStore.getState().setGestureFrame(null);
    },
    [],
  );

  const onLayerTransformEnd = useCallback(
    (frameId: string, layerId: string, e: Konva.KonvaEventObject<Event>) => {
      snapRef.current.clearGuides();
      const node = e.target as Konva.Image;
      if (interrupting()) putBack(frameId, layerId, node);
      else {
        useInputStore.getState().patchTransform(frameId, layerId, {
          x: node.x(),
          y: node.y(),
          scaleX: node.scaleX(),
          scaleY: node.scaleY(),
          rotation: node.rotation(),
        });
      }
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
