import { useGenerationStore } from "@/stores/generationStore";
import { useInputStore } from "@/stores/inputStore";
import { flattenCanvas } from "@/lib/flattenCanvas";
import { firstComposite } from "@/lib/inputs/outline";
import { compositeKey } from "@/lib/media/keys";
import { fitTo } from "@/lib/media/sizeRule";
import { captionRule } from "@/inputs/fit";
import { sendOne, type UploadBatch } from "@/inputs/uploads";

/** Vision image for prompt enhance: the first Initial frame that sends a
 * picture, flattened at the size the captioner reads it, sent on the action's
 * batch under what it is made of, so a repeated Enhance claims it. Null when
 * there is none. */
export async function imageCanvasVisionSource(batch: UploadBatch): Promise<string | null> {
  const { width, height } = useGenerationStore.getState();
  const layers = firstComposite(useInputStore.getState().frames);
  if (!layers?.some((layer) => layer.visible)) return null;
  const size = { width, height };
  const rule = await captionRule();
  const fit = rule ? fitTo(rule, size) : null;
  // the captioner crops a cover fit itself, so only a stretch is drawn here
  const drawnAt = fit?.mode === "stretch" ? { width: fit.width, height: fit.height } : size;
  return sendOne(batch, () => flattenCanvas(layers, width, height, drawnAt), {
    name: "vision.png",
    key: compositeKey(layers, size, drawnAt, null),
    dims: drawnAt,
  });
}
