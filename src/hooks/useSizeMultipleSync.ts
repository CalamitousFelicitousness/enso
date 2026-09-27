import { useEffect } from "react";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import { DEFAULT_SIZE_MULTIPLE } from "@/lib/sizeCompute";
import { useCanvasStore } from "@/stores/canvasStore";

/** Keeps the canvas size step on the loaded local model's size multiple. */
export function useSizeMultipleSync() {
  const { kind, sizeMultiple } = useModelCapabilities();
  const multiple =
    kind === "local" ? (sizeMultiple ?? DEFAULT_SIZE_MULTIPLE) : DEFAULT_SIZE_MULTIPLE;
  useEffect(() => {
    useCanvasStore.getState().setSizeMultiple(multiple);
  }, [multiple]);
}
