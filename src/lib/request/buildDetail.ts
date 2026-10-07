import { useGenerationStore } from "@/stores/generationStore";
import { useInputStore } from "@/stores/inputStore";
import { flattenCanvas } from "@/lib/flattenCanvas";
import { uploadBlob } from "@/lib/upload";
import { firstComposite } from "@/lib/inputs/outline";
import type { DetailJobParams } from "@/api/types/v2";
import { serializeDetailerEntry, stripUndefined } from "./wire";

export interface BuildDetailResult {
  request: DetailJobParams;
}

/** Build a "Detail only" job: flatten canvas, upload, request detailer-only pass.
 * The backend will skip encode/base/hires entirely and run only the detailer on the input. */
export async function buildDetailRequest(): Promise<BuildDetailResult> {
  const gen = useGenerationStore.getState();

  // Detail-only runs on the first Initial frame that sends a picture.
  const layers = firstComposite(useInputStore.getState().frames);
  if (!layers) {
    throw new Error("Detail only requires an image on the canvas");
  }

  const flattenedBlob = await flattenCanvas(layers, gen.width, gen.height);
  if (!flattenedBlob) {
    throw new Error("Failed to flatten canvas for detail job");
  }
  const ref = await uploadBlob(flattenedBlob, "input.png");

  const request: DetailJobParams = {
    type: "detail",
    inputs: [ref],
    width: gen.width,
    height: gen.height,
    prompt: gen.prompt,
    negative_prompt: gen.negativePrompt,
    seed: gen.seed,
    sampler_name: gen.sampler,
    detailer_enabled: true,
    detailer_defaults: stripUndefined(gen.detailerDefaults),
    detailer_models: gen.detailerModels.map(serializeDetailerEntry),
    save_images: true,
  };

  if (gen.overrideSettings && Object.keys(gen.overrideSettings).length > 0) {
    request.override_settings = { ...gen.overrideSettings };
  }

  return { request };
}
