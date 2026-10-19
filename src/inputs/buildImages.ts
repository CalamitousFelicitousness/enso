// The Images submission from the stores: the request for the picked model,
// the inputs it uploads and the record that goes with it. Generate loads the
// pick first, records the prompt and clears the result selection; a recipe
// save does none of these.

import { toast } from "sonner";
import { api } from "@/api/client";
import { queryClient } from "@/api/queryClient";
import { preprocessorsQuery } from "@/api/hooks/useControl";
import type { CheckpointInfoV2, DetailerMode, SetCheckpointResponse } from "@/api/types/models";
import type { ServerInfo } from "@/api/types/server";
import { UserAbortError } from "@/lib/abort";
import { processorFacts } from "@/lib/processorUtils";
import { buildCloudImageRequest } from "@/lib/request/buildCloudImage";
import { buildDetailRequest } from "@/lib/request/buildDetail";
import { buildControlRequest } from "@/lib/request/buildGenerate";
import { InputRefusal } from "@/lib/request/refusal";
import { DEFAULT_SIZE_MULTIPLE, referenceSetsSize } from "@/lib/sizeCompute";
import { useGenerationStore } from "@/stores/generationStore";
import {
  capabilityRecord,
  recordSizes,
  useModelCapabilityStore,
  type ModelCapabilityRecord,
} from "@/stores/modelCapabilityStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import type { PromptHistoryDraft } from "@/stores/promptHistoryStore";
import { submissionOf, type Submission } from "./submit";
import type { UploadBatch } from "./uploads";

export interface ImagesDeps {
  /** Loads the pick when another model is loaded; without it the request is
   * built from what the pick reported when it was last loaded. */
  loadModel?: (title: string) => Promise<SetCheckpointResponse>;
  recordPrompt?: (draft: PromptHistoryDraft) => void;
  clearSelection?: () => void;
}

const fetchCheckpoint = (staleTime: number) =>
  queryClient.fetchQuery({
    queryKey: ["checkpoint"],
    queryFn: () => api.get<CheckpointInfoV2>("/sdapi/v2/checkpoint"),
    staleTime,
  });

/** What the builder needs to know of the model a request is for. */
interface ModelFacts {
  maxInputImages: number | null;
  requestSetsSize: boolean | null;
  sizeMultiple: number;
  detailerMode: DetailerMode | null;
  strengthSupported: boolean;
  controlUnified: boolean | null;
}

function factsOf(record: ModelCapabilityRecord | undefined): ModelFacts {
  return {
    maxInputImages: record?.max_input_images ?? null,
    requestSetsSize: record?.request_sets_size ?? null,
    sizeMultiple: record?.size_multiple ?? DEFAULT_SIZE_MULTIPLE,
    detailerMode: record?.detailer_mode ?? null,
    strengthSupported: record?.strength_applicable ?? true,
    controlUnified: record?.control_unified ?? null,
  };
}

export async function buildImagesSubmission(
  batch: UploadBatch,
  deps: ImagesDeps = {},
): Promise<Submission> {
  const { activeModel } = useModelSelectionStore.getState();

  // The Video panel's model cannot make an image request; UserAbortError
  // tells the caller the guidance was already shown
  if (activeModel?.source === "local-video") {
    toast.warning("Switch to Video view to use this model");
    throw new UserAbortError("local-video model active on Images view");
  }

  let facts = factsOf(undefined);
  let controlSeparateInit: boolean | null = null;
  let sizes = { shown: recordSizes(null), loaded: recordSizes(null) };
  let checkpoint: Submission["checkpoint"] =
    activeModel?.source === "cloud"
      ? { title: `${activeModel.provider}/${activeModel.id}`, name: activeModel.name }
      : null;
  // The canvas sized a lone Reference from the model it knew before any load
  let referenceSets = activeModel?.source !== "cloud";
  if (activeModel?.source === "local") {
    // A pick only updates the store; the server may hold another model. Going
    // through the shared ["checkpoint"] query and load mutation refreshes the
    // Top Bar and dedupes one load across Batch and XYZ.
    let loaded = await fetchCheckpoint(30_000);
    const shown = loaded.loaded && loaded.title === activeModel.title;
    const remembered: ModelCapabilityRecord | undefined =
      useModelCapabilityStore.getState().byTitle[activeModel.title];
    referenceSets = referenceSetsSize(
      true,
      (shown ? loaded.request_sets_size : remembered?.request_sets_size) ?? null,
    );
    const shownSizes = recordSizes(shown ? capabilityRecord(loaded) : remembered);
    if (shown) {
      facts = factsOf(capabilityRecord(loaded));
      sizes = { shown: shownSizes, loaded: shownSizes };
    } else if (deps.loadModel) {
      toast.info("Loading model", { description: activeModel.title });
      const answer = await deps.loadModel(activeModel.title);
      if (!answer.ok) {
        toast.error(`Could not load ${activeModel.model_name}`);
        throw new UserAbortError(`model load failed: ${activeModel.title}`);
      }
      // The input limit and size multiple belong to the model just loaded
      loaded = await fetchCheckpoint(0);
      facts = factsOf(capabilityRecord(loaded));
      sizes = { shown: shownSizes, loaded: recordSizes(capabilityRecord(loaded)) };
    } else {
      facts = factsOf(remembered);
      sizes = { shown: shownSizes, loaded: shownSizes };
    }
    checkpoint = {
      title: shown || deps.loadModel ? (loaded.title ?? activeModel.title) : activeModel.title,
      name: activeModel.model_name,
    };
    // Whether this sdnext leaves a control unit its own picture beside an Initial picture
    const info = await queryClient.fetchQuery({
      queryKey: ["server-info"],
      queryFn: () => api.get<ServerInfo>("/sdapi/v2/server-info"),
      staleTime: 30_000,
    });
    controlSeparateInit = info.capabilities?.control_separate_init ?? null;
  }

  const submitted = useGenerationStore.getState();
  deps.recordPrompt?.({
    prompt: submitted.prompt,
    negative: submitted.negativePrompt,
    model: activeModel
      ? activeModel.source === "local"
        ? activeModel.model_name
        : activeModel.name
      : "",
    width: submitted.width,
    height: submitted.height,
    steps: submitted.steps,
  });

  // Every map key names the server's processors: the list is fetched, not
  // taken from a canvas that may not have it yet
  const processors = processorFacts(await queryClient.fetchQuery(preprocessorsQuery));

  if (activeModel?.source === "cloud") {
    const { request, inputs, uploader } = await buildCloudImageRequest(processors, batch);
    deps.clearSelection?.();
    return submissionOf({
      domain: "generate",
      request,
      batch,
      uploader,
      inputs,
      mapKeys: [],
      checkpoint,
    });
  }

  if (submitted.detailerEnabled && submitted.detailerOnly) {
    const { request, inputs, uploader } = await buildDetailRequest(batch);
    deps.clearSelection?.();
    return submissionOf({
      domain: "generate",
      request,
      batch,
      uploader,
      inputs,
      mapKeys: [],
      checkpoint,
    });
  }

  const { request, mapKeys, inputs, uploader } = await buildControlRequest({
    ...facts,
    referenceSets,
    controlSeparateInit,
    sizes,
    processors,
    batch,
  }).catch((err: unknown) => {
    if (err instanceof InputRefusal) {
      toast.warning("Can't generate with these input images", { description: err.message });
      throw new UserAbortError(err.message);
    }
    throw err;
  });
  deps.clearSelection?.();
  return submissionOf({
    domain: "generate",
    request: { type: "generate", ...request },
    batch,
    uploader,
    inputs,
    mapKeys,
    checkpoint,
  });
}
