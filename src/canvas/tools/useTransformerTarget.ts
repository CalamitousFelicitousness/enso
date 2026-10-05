import { useCallback, useEffect, useRef } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import type Konva from "konva";

/** The Konva node the Transformer belongs on, as a node map key: the active
 * layer of an Initial frame, unless it is locked or not drawn. */
function targetKey(): string | null {
  const { activeItem, frames } = useInputStore.getState();
  const { activeTool, maskVisible } = useCanvasStore.getState();
  if (!activeItem || activeTool !== "move") return null;
  const frame = frames.find((f) => f.id === activeItem.frameId);
  if (!frame || frame.role !== "initial") return null;
  const picture = frame.pictures.find((p) => p.id === activeItem.id);
  const mask = frame.mask.objects.find((m) => m.id === activeItem.id);
  const drawn = picture ? picture.visible : !!mask && mask.visible && maskVisible;
  const locked = picture?.locked ?? mask?.locked ?? true;
  return drawn && !locked ? `${frame.id}:${activeItem.id}` : null;
}

/** Owns the map of layer nodes and keeps the Transformer on the active one.
 * Nodes register as their images decode, so the Transformer is re-attached
 * whenever the map changes as well as when the selection does. */
export function useTransformerTarget(trRef: React.RefObject<Konva.Transformer | null>) {
  // Konva nodes keyed `${frameId}:${layerId}`
  const nodes = useRef<Map<string, Konva.Image>>(new Map());
  const queued = useRef(false);

  const attach = useCallback(() => {
    const tr = trRef.current;
    if (!tr) return;
    const key = targetKey();
    const node = key ? nodes.current.get(key) : undefined;
    const current = tr.nodes();
    if (node ? current.length === 1 && current[0] === node : current.length === 0) return;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [trRef]);

  const setNodeRef = useCallback(
    (frameId: string, layerId: string, node: Konva.Image | null) => {
      const key = `${frameId}:${layerId}`;
      if (node) nodes.current.set(key, node);
      else nodes.current.delete(key);
      if (queued.current) return;
      queued.current = true;
      queueMicrotask(() => {
        queued.current = false;
        attach();
      });
    },
    [attach],
  );

  useEffect(() => {
    attach();
    const stopInputs = useInputStore.subscribe(attach);
    const stopCanvas = useCanvasStore.subscribe((state, prev) => {
      if (state.activeTool !== prev.activeTool || state.maskVisible !== prev.maskVisible) attach();
    });
    return () => {
      stopInputs();
      stopCanvas();
    };
  }, [attach]);

  return { setNodeRef };
}
