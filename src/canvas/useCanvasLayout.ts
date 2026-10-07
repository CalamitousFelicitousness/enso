// The canvas layout as a hook: the stores' facts go into the pure
// computeCanvasLayout, plus the generation size and the output frame the
// consumers read beside it.

import { useMemo } from "react";
import { useGenerationStore } from "@/stores/generationStore";
import { useFrameSize } from "@/canvas/useFrameSize";
import { useUiStore } from "@/stores/uiStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useOutline } from "@/inputs/useOutline";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useInputsAtCapacity } from "@/canvas/useInputsAtCapacity";
import { effectiveSizeMode, resolveGenerationSize } from "@/lib/sizeCompute";
import { computeCanvasLayout, type FrameLayout } from "@/lib/inputs/layout";

export interface CanvasLayout extends FrameLayout {
  /** Generation size (may differ from frame size when scale/megapixel is active) */
  genSize: { width: number; height: number };
  /** Output frame dimensions. Equals the frame when Auto is off; when Auto is
   * on for a cloud model, predicts the server-chosen aspect from the last
   * result's echoed dims, falling back to the model's size_constraint default. */
  outputFrameW: number;
  outputFrameH: number;
  /** The input frames hold as many images as the active model takes. */
  inputsAtCapacity: boolean;
}

export function useCanvasLayout(): CanvasLayout {
  const { width: frameW, height: frameH, referenceSets } = useFrameSize();
  const lastResult = useGenerationStore((s) => s.results[0]);
  const outline = useOutline();
  const autoFitFrame = useUiStore((s) => s.autoFitFrame);
  const labelScale = useUiStore((s) => s.canvasLabelScale);
  const sizeMode = useImg2ImgStore((s) => s.sizeMode);
  const scaleFactor = useImg2ImgStore((s) => s.scaleFactor);
  const megapixelTarget = useImg2ImgStore((s) => s.megapixelTarget);
  const autoSize = useImg2ImgStore((s) => s.autoSize);
  const activeModel = useModelSelectionStore((s) => s.activeModel);
  const sizeMultiple = useCanvasStore((s) => s.sizeMultiple);
  const compositeProcessed = useCanvasStore((s) => s.processedUrl !== null);
  const inputsAtCapacity = useInputsAtCapacity();

  return useMemo(() => {
    const genSize = resolveGenerationSize(
      effectiveSizeMode(sizeMode, autoFitFrame, outline.sent, referenceSets),
      frameW,
      frameH,
      scaleFactor,
      megapixelTarget,
      sizeMultiple,
    );

    // Auto on a cloud model: the server picks the size, so the output frame
    // takes the aspect of the last result, else the model's default, so the
    // canvas shows a plausible shape before the first generation.
    let predictedOutputAspect: number | null = null;
    if (autoSize && activeModel?.source === "cloud") {
      if (lastResult?.info) {
        try {
          const info = JSON.parse(lastResult.info) as { width?: unknown; height?: unknown };
          const w = info.width;
          const h = info.height;
          if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) {
            predictedOutputAspect = w / h;
          }
        } catch {
          // no usable info; the default below applies
        }
      }
      if (predictedOutputAspect == null && activeModel.size_constraint?.default) {
        const parts = activeModel.size_constraint.default.split("x").map((s) => parseInt(s, 10));
        if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
          predictedOutputAspect = parts[0] / parts[1];
        }
      }
    }
    const outputFrameH = frameH;
    const outputFrameW = predictedOutputAspect != null ? frameH * predictedOutputAspect : frameW;

    const layout = computeCanvasLayout({
      entries: outline.entries,
      frame: { width: frameW, height: frameH },
      output: { width: outputFrameW, height: outputFrameH },
      labelScale,
      inputsAtCapacity,
      compositeProcessed,
    });
    return { ...layout, genSize, outputFrameW, outputFrameH, inputsAtCapacity };
  }, [
    frameW,
    frameH,
    referenceSets,
    lastResult,
    outline,
    autoFitFrame,
    labelScale,
    sizeMode,
    scaleFactor,
    megapixelTarget,
    autoSize,
    activeModel,
    sizeMultiple,
    compositeProcessed,
    inputsAtCapacity,
  ]);
}
