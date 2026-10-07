import { useMemo } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useInputStore } from "@/stores/inputStore";
import { loneReference } from "@/lib/inputs/outline";
import { outlineOf } from "@/inputs/outlineOf";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import { imageOutputSize, referenceSetsSize } from "@/lib/sizeCompute";

export interface FrameSize {
  width: number;
  height: number;
  /** The loaded model generates a lone Reference at the image's size. */
  referenceSets: boolean;
  /** Natural size of the lone Reference that sets the frame, or null while
   * Width and Height set it. */
  lockedTo: { width: number; height: number } | null;
  /** The selected local model is not loaded, so how it sizes a lone Reference
   * is not known yet. */
  pending: boolean;
}

/** The generation frame: Width and Height as set, or the size the server makes
 * from a lone Reference on a model that generates at the image's size. */
export function useFrameSize(): FrameSize {
  const width = useGenerationStore((s) => s.width);
  const height = useGenerationStore((s) => s.height);
  const lone = useInputStore((s) => loneReference(outlineOf(s.frames)));
  const { kind, requestSetsSize } = useModelCapabilities();
  const multiple = useCanvasStore((s) => s.sizeMultiple);
  return useMemo(() => {
    const referenceSets = referenceSetsSize(kind !== "cloud", requestSetsSize);
    const lockedTo = referenceSets && lone ? { width: lone.width, height: lone.height } : null;
    const size = lockedTo ? imageOutputSize(lockedTo, multiple) : { width, height };
    return {
      ...size,
      referenceSets,
      lockedTo,
      pending: kind !== "cloud" && requestSetsSize == null,
    };
  }, [width, height, lone, kind, requestSetsSize, multiple]);
}
