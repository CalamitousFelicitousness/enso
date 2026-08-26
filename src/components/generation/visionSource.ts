import { useGenerationStore } from "@/stores/generationStore";
import { useCanvasStore } from "@/stores/canvasStore";
import type { ImageLayer } from "@/stores/canvasStore";
import { flattenCanvas } from "@/lib/flattenCanvas";
import { uploadBlob } from "@/lib/upload";

/** Vision image for prompt enhance: the first Initial frame, flattened. */
export async function imageCanvasVisionSource(): Promise<string | null> {
  const { width, height } = useGenerationStore.getState();
  const inputFrames = useCanvasStore.getState().inputFrames;
  const firstInitial = inputFrames.find(
    (f) => f.mode === "initial" && f.layers.some((l) => l.type === "image"),
  );
  const layers: ImageLayer[] =
    firstInitial && firstInitial.mode === "initial"
      ? firstInitial.layers.filter((l): l is ImageLayer => l.type === "image")
      : [];
  const blob = await flattenCanvas(layers, width, height);
  return blob ? await uploadBlob(blob, "vision.png") : null;
}
