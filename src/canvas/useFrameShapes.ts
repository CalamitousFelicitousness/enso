import { useRef } from "react";
import { toFrameShape, type FrameShape } from "@/canvas/inputFrames";
import { useCanvasStore } from "@/stores/canvasStore";

function sameShapes(a: FrameShape[], b: FrameShape[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return (
        x.id === y.id &&
        x.mode === y.mode &&
        x.hasImage === y.hasImage &&
        x.references === y.references
      );
    })
  );
}

/** `inputFrames` as FrameShapes. Returns the previous array while no shape
 * changed, so mask edits do not re-render layout consumers. */
export function useFrameShapes(): FrameShape[] {
  const prev = useRef<FrameShape[]>([]);
  return useCanvasStore((s) => {
    const next = s.inputFrames.map(toFrameShape);
    if (sameShapes(prev.current, next)) return prev.current;
    prev.current = next;
    return next;
  });
}
