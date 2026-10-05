import { useGenerationStore } from "@/stores/generationStore";
import { useInputStore } from "@/stores/inputStore";
import { flattenCanvas } from "@/lib/flattenCanvas";
import { uploadBlob } from "@/lib/upload";
import { firstComposite } from "@/lib/inputs/outline";

/** Vision image for prompt enhance: the first Initial frame that sends a
 * picture, flattened. Null when there is none. */
export async function imageCanvasVisionSource(): Promise<string | null> {
  const { width, height } = useGenerationStore.getState();
  const layers = firstComposite(useInputStore.getState().frames);
  const blob = layers ? await flattenCanvas(layers, width, height) : null;
  return blob ? await uploadBlob(blob, "vision.png") : null;
}
