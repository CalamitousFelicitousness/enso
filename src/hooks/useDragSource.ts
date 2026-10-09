import { useCallback, useEffect, useRef } from "react";
import { mimeOf, type DragPayload } from "@/lib/drag";

/** Make an element carry a payload when dragged; null leaves it undraggable. */
export function useDragSource(payload: DragPayload | null) {
  const payloadRef = useRef(payload);
  useEffect(() => {
    payloadRef.current = payload;
  });

  const onDragStart = useCallback((e: React.DragEvent) => {
    const p = payloadRef.current;
    if (!p) {
      e.preventDefault();
      return;
    }
    // An entry carries nothing but itself: no picture another target could take
    if (p.type === "library-entry") e.dataTransfer.clearData();
    e.dataTransfer.setData(mimeOf(p), JSON.stringify(p));
    e.dataTransfer.effectAllowed = "copy";
    if (p.src) {
      const img = new Image();
      img.src = p.src;
      e.dataTransfer.setDragImage(img, 24, 24);
    }
  }, []);

  return { draggable: payload !== null, onDragStart };
}
