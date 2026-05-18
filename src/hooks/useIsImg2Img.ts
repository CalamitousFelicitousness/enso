import { useCanvasStore } from "@/stores/canvasStore";

export function useIsImg2Img() {
  return useCanvasStore((s) =>
    s.inputFrames.some(
      (f) => f.mode === "initial" && f.layers.some((l) => l.type === "image" && l.visible),
    ),
  );
}
