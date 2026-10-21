// A replayed job's model goes in queue order: when this server has its file
// and another model is loaded, a model-load job is queued ahead of it, so a
// job queued earlier still runs on the model it was queued for.

import { api } from "@/api/client";
import { modelListQuery } from "@/api/hooks/useModels";
import { queueModelLoad } from "@/api/models";
import { queryClient } from "@/api/queryClient";
import type { CheckpointInfoV2 } from "@/api/types/models";
import { checkpointState, type ModelState } from "@/lib/recipes/models";
import type { ModelId } from "@/lib/recipes/recipe";
import { modelCheckFailedText, modelLoadFailedText } from "@/lib/recipes/text";
import { useModelHashStore } from "@/stores/modelHashStore";

/** What happens to the model: its load was queued; it is loaded, or the server
 * says no more than the job will; or this server lacks its file and the job
 * runs on the loaded model. */
export type ModelFirst =
  | { kind: "loads"; model: string }
  | { kind: "loaded" }
  | { kind: "other"; state: Exclude<ModelState, "installed">; loaded: string };

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Throws with words when the model list cannot be read or the load is
 * refused, so the job is not sent to run on another model. */
export async function modelFirst(model: ModelId): Promise<ModelFirst> {
  let loaded: CheckpointInfoV2;
  try {
    loaded = await queryClient.fetchQuery({
      queryKey: ["checkpoint"],
      queryFn: () => api.get<CheckpointInfoV2>("/sdapi/v2/checkpoint"),
      staleTime: 30_000,
    });
  } catch {
    return { kind: "loaded" };
  }
  if (!loaded.loaded || !loaded.title || loaded.title === model.title) return { kind: "loaded" };
  const installed = await queryClient.fetchQuery(modelListQuery).catch((err: unknown) => {
    throw new Error(modelCheckFailedText(model.name, reasonOf(err)), { cause: err });
  });
  const { state, match } = checkpointState(
    model,
    installed,
    useModelHashStore.getState().downloads,
  );
  if (state !== "installed") return { kind: "other", state, loaded: loaded.name ?? loaded.title };
  if (!match || match.title === loaded.title) return { kind: "loaded" };
  await queueModelLoad(match.title).catch((err: unknown) => {
    throw new Error(modelLoadFailedText(match.model_name, reasonOf(err)), { cause: err });
  });
  return { kind: "loads", model: match.model_name };
}
