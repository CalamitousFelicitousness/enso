import { useVideoCanvasStore } from "@/stores/videoCanvasStore";

/** A file on the video canvas and the id of the frame or reference holding it. */
export interface VideoInput {
  id: string;
  file: File;
}

// The video canvas owns the input images; payload builders read them here
// instead of through mirrored store fields.
export function getVideoInputs(): {
  init: VideoInput | null;
  last: VideoInput | null;
  refs: VideoInput[];
} {
  const s = useVideoCanvasStore.getState();
  const input = (frame: { id: string; file: File } | null) =>
    frame ? { id: frame.id, file: frame.file } : null;
  return {
    init: input(s.initFrame),
    last: input(s.lastFrame),
    refs: s.references.map((r) => ({ id: r.id, file: r.file })),
  };
}
