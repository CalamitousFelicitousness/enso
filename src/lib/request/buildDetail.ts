import { useGenerationStore } from "@/stores/generationStore";
import { useInputStore } from "@/stores/inputStore";
import { createUploader, type Ledger } from "@/inputs/materialise";
import { computeOutline, firstInitialEntry } from "@/lib/inputs/outline";
import type { Inputs } from "@/lib/inputs/stored";
import { detailProcessedText, unreadableText } from "@/lib/inputs/text";
import { activeProcessor } from "@/lib/inputs/types";
import type { DetailJobParams } from "@/api/types/v2";
import { serializeDetailerEntry, stripUndefined } from "./wire";

export interface BuildDetailResult {
  request: DetailJobParams;
  /** The frames the request was built from. */
  inputs: Inputs;
  /** Where each upload the request names came from. */
  ledger: Ledger;
}

/** Build a "Detail only" job: flatten canvas, upload, request detailer-only pass.
 * The backend will skip encode/base/hires entirely and run only the detailer on the input. */
export async function buildDetailRequest(): Promise<BuildDetailResult> {
  const gen = useGenerationStore.getState();

  // Detail-only runs on the first Initial frame that sends a picture, as it is
  const { frames, sizeSource } = useInputStore.getState();
  const first = firstInitialEntry(computeOutline(frames));
  const source = first && frames.find((f) => f.id === first.frameId);
  if (!first || !source) {
    throw new Error("Detail only requires an image on the canvas");
  }
  if (activeProcessor(source)) {
    throw new Error(detailProcessedText(first.position));
  }
  const unreadable = unreadableText([first]);
  if (unreadable) throw new Error(unreadable);

  const frame = { width: gen.width, height: gen.height };
  const up = createUploader({ frames, size: frame });
  const { ref } = await up.composite(first.frameId, frame);

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

  return { request, inputs: { frames, size: frame, sizeSource }, ledger: up.ledger };
}
