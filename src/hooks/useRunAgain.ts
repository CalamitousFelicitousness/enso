// Run a job again from this browser's record of it: every picture is made
// again from its source over the frames the record kept and uploaded afresh,
// and the request goes out as it was sent, on whatever model is loaded.

import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { queryClient } from "@/api/queryClient";
import type { CheckpointInfoV2 } from "@/api/types/models";
import type { Job } from "@/api/types/v2";
import { loadJobForReplay, submitJob } from "@/inputs/jobs";
import { replay } from "@/inputs/materialise";
import { replayProblem } from "@/lib/jobs/replay";
import {
  OTHER_MODEL,
  otherModelText,
  reasonText,
  RUN_AGAIN_FAILED,
  RUN_AGAIN_QUEUED,
} from "@/lib/jobs/text";

/** Request types that run on the loaded checkpoint. */
const LOCAL = new Set(["generate", "detail", "xyz-grid"]);

const busy = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version += 1;
  listeners.forEach((l) => l());
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Say so when the loaded model is not the one the job ran on. */
async function noteModel(checkpoint: { title: string; name: string }): Promise<void> {
  try {
    const loaded = await queryClient.fetchQuery({
      queryKey: ["checkpoint"],
      queryFn: () => api.get<CheckpointInfoV2>("/sdapi/v2/checkpoint"),
      staleTime: 30_000,
    });
    if (loaded.loaded && loaded.title && loaded.title !== checkpoint.title) {
      toast.info(OTHER_MODEL, {
        description: otherModelText(checkpoint.name, loaded.name ?? loaded.title),
      });
    }
  } catch {
    // the server says no more than the job will
  }
}

/** Send a recorded job again. Null when it was not sent; the reason is told. */
export async function runAgain(jobId: string): Promise<Job | null> {
  if (busy.has(jobId)) return null;
  busy.add(jobId);
  changed();
  try {
    const load = await loadJobForReplay(jobId);
    if (!load) {
      toast.error(RUN_AGAIN_FAILED, { description: reasonText("notStored") });
      return null;
    }
    const { record } = load;
    const problem = replayProblem(record);
    if (problem) {
      toast.error(RUN_AGAIN_FAILED, { description: reasonText(problem) });
      return null;
    }
    const type = record.request["type"];
    if (record.checkpoint && typeof type === "string" && LOCAL.has(type)) {
      await noteModel(record.checkpoint);
    }
    const { request, ledger } = await replay(record, load.inputs, load.held);
    const job = await submitJob({
      domain: record.domain,
      request,
      ledger,
      inputs: record.inputs,
      mapKeys: record.mapKeys,
      checkpoint: record.checkpoint,
    });
    toast.success(RUN_AGAIN_QUEUED);
    return job;
  } catch (err) {
    toast.error(RUN_AGAIN_FAILED, {
      description: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    busy.delete(jobId);
    changed();
  }
}

/** Run again, and whether a job is being sent again right now. */
export function useRunAgain(): {
  runAgain: (jobId: string) => Promise<Job | null>;
  isRunning: (jobId: string) => boolean;
} {
  const current = useSyncExternalStore(subscribe, () => version);
  const isRunning = useCallback((jobId: string) => current >= 0 && busy.has(jobId), [current]);
  return { runAgain, isRunning };
}
