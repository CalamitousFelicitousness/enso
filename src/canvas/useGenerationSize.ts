import { useMemo } from "react";
import { useFrameSize } from "@/canvas/useFrameSize";
import { outlineOf } from "@/inputs/outlineOf";
import { effectiveSizeMode, resolveGenerationSize } from "@/lib/sizeCompute";
import { useCanvasStore } from "@/stores/canvasStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useInputStore } from "@/stores/inputStore";
import { useUiStore } from "@/stores/uiStore";

/** The size the request generates at, as the canvas shows it: the frame
 * (Width and Height, or the size a lone Reference sets) under the size mode
 * that applies. The request builder resizes pictures to the same size
 * (`sendSize`), so the map keys the canvas shows are the ones it sends. */
export function useGenerationSize(): { width: number; height: number } {
  const { width, height, referenceSets } = useFrameSize();
  const sent = useInputStore((s) => outlineOf(s.frames).sent);
  const autoFit = useUiStore((s) => s.autoFitFrame);
  const sizeMode = useImg2ImgStore((s) => s.sizeMode);
  const scaleFactor = useImg2ImgStore((s) => s.scaleFactor);
  const megapixelTarget = useImg2ImgStore((s) => s.megapixelTarget);
  const sizeMultiple = useCanvasStore((s) => s.sizeMultiple);
  return useMemo(
    () =>
      resolveGenerationSize(
        effectiveSizeMode(sizeMode, autoFit, sent, referenceSets),
        width,
        height,
        scaleFactor,
        megapixelTarget,
        sizeMultiple,
      ),
    [
      width,
      height,
      referenceSets,
      sent,
      autoFit,
      sizeMode,
      scaleFactor,
      megapixelTarget,
      sizeMultiple,
    ],
  );
}
