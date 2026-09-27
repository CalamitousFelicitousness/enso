import { useMemo } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useUiStore } from "@/stores/uiStore";
import {
  parseSizeSourceValue,
  resolveSizeSource,
  sizeSourceRef,
  sizeSourceValue,
  sourceImageSize,
  wireSources,
  type SizeSourceRef,
} from "@/canvas/inputFrames";

export const SIZE_SOURCE_HINT = "Output size is based on this image";

export interface SizeSourceOption {
  value: string;
  label: string;
}

// Selectors return strings, so mask strokes and layer moves re-render nothing

/** Every input image that can set the frame size, as the Size from list shows it. */
export function useSizeSourceOptions(): SizeSourceOption[] {
  const rows = useCanvasStore((s) =>
    wireSources(s.inputFrames)
      .map((source) => {
        const { width, height } = sourceImageSize(source);
        const kind = source.kind === "initial" ? "Initial" : "Reference";
        const label = `Input ${source.slot.globalIndex} · ${kind} · ${width}×${height}`;
        return `${sizeSourceValue(sizeSourceRef(source))}\t${label}`;
      })
      .join("\n"),
  );
  return useMemo(
    () =>
      rows
        ? rows.split("\n").map((row) => {
            const [value, label] = row.split("\t");
            return { value, label };
          })
        : [],
    [rows],
  );
}

/** The input image that sets the frame size, as a Size from value; "" when the
 * canvas holds no input image. */
export function useSizeSourceValue(): string {
  return useCanvasStore((s) => {
    const source = resolveSizeSource(wireSources(s.inputFrames), s.sizeSource);
    return source ? sizeSourceValue(sizeSourceRef(source)) : "";
  });
}

/** The size source to mark on the canvas: only while Fit is on and more than
 * one input image could set the size. */
export function useSizeSourceMark(slotCount: number): SizeSourceRef | null {
  const fit = useUiStore((s) => s.autoFitFrame);
  const value = useSizeSourceValue();
  return useMemo(
    () => (fit && slotCount > 1 && value ? parseSizeSourceValue(value) : null),
    [fit, slotCount, value],
  );
}
