import { useVideoCanvasStore } from "@/stores/videoCanvasStore";

// The video canvas owns the input images; payload builders read them here
// instead of through mirrored store fields.
export function getVideoInputs(): { init: File | null; last: File | null; refs: File[] } {
  const s = useVideoCanvasStore.getState();
  return {
    init: s.initFrame?.file ?? null,
    last: s.lastFrame?.file ?? null,
    refs: s.references.map((r) => r.file),
  };
}
