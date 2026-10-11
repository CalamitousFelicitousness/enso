import { useGenerationStore } from "@/stores/generationStore";
import { useInputStore } from "@/stores/inputStore";
import { flattenCanvas } from "@/lib/flattenCanvas";
import { firstComposite } from "@/lib/inputs/outline";
import { compositeKey } from "@/lib/media/keys";
import { sendOne, type UploadBatch } from "@/inputs/uploads";

/** Vision image for prompt enhance: the first Initial frame that sends a
 * picture, flattened, sent on the action's batch under what it is made of,
 * so a repeated Enhance claims it. Null when there is none. */
export async function imageCanvasVisionSource(batch: UploadBatch): Promise<string | null> {
  const { width, height } = useGenerationStore.getState();
  const layers = firstComposite(useInputStore.getState().frames);
  if (!layers?.some((layer) => layer.visible)) return null;
  const size = { width, height };
  return sendOne(batch, () => flattenCanvas(layers, width, height), {
    name: "vision.png",
    key: compositeKey(layers, size, size, null),
    dims: size,
  });
}
