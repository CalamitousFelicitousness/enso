// Run a job again from its record: every upload is staged under the hash it
// went out with, so the server's copies go as they are and only what it lacks
// is made again from the record's frames. The request goes out as it was
// sent: an image job after a load of its own model when this server has the
// file, else on the loaded one; a video job loads its own when it runs. Its
// uploads can be cancelled from its toast; its post cannot.

import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { queryClient } from "@/api/queryClient";
import type { CheckpointInfoV2 } from "@/api/types/models";
import { modelListQuery } from "@/api/hooks/useModels";
import { queueModelLoad } from "@/api/models";
import { checkpointState, recordedModel } from "@/lib/recipes/models";
import type { Job } from "@/api/types/v2";
import { readBlobs } from "@/inputs/db";
import { loadRecord, replaySubmission, type RecordLoad } from "@/inputs/jobs";
import { submitJob } from "@/inputs/submit";
import { UploadBatch } from "@/inputs/uploads";
import { UserAbortError } from "@/lib/abort";
import { replayGone, replayProblem } from "@/lib/jobs/replay";
import { loadsModel } from "@/lib/jobs/requests";
import {
  OTHER_MODEL,
  otherModelText,
  reasonText,
  replayMissingText,
  RUN_AGAIN_FAILED,
  runAgainQueuedText,
  type ReplayMissing,
} from "@/lib/jobs/text";
import { batchText, CANCEL, UPLOAD_CANCELLED } from "@/lib/media/text";

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

/** When another model is loaded: queue a load of the job's own ahead of it if
 * this server has that file, else say the job runs on the loaded model.
 * Returns the model loaded first. */
async function modelFirst(checkpoint: { title: string; name: string }): Promise<string | null> {
  let loaded: CheckpointInfoV2;
  try {
    loaded = await queryClient.fetchQuery({
      queryKey: ["checkpoint"],
      queryFn: () => api.get<CheckpointInfoV2>("/sdapi/v2/checkpoint"),
      staleTime: 30_000,
    });
  } catch {
    // the server says no more than the job will
    return null;
  }
  if (!loaded.loaded || !loaded.title || loaded.title === checkpoint.title) return null;
  try {
    const installed = await queryClient.fetchQuery(modelListQuery);
    const { state, match } = checkpointState(recordedModel(checkpoint), installed);
    if (state === "installed" && match && match.title !== loaded.title) {
      await queueModelLoad(match.title);
      return match.model_name;
    }
  } catch {
    // without the list or the load, the job runs on the loaded model as the note says
  }
  toast.info(OTHER_MODEL, {
    description: otherModelText(checkpoint.name, loaded.name ?? loaded.title),
  });
  return null;
}

/** What the server lost that cannot be made again: a source reads a picture
 * neither the server nor this browser holds, or there is no source. */
async function goneForGood(load: RecordLoad): Promise<ReplayMissing | null> {
  const unheld = [...load.unheld];
  const here =
    unheld.length > 0 ? await readBlobs(unheld).catch(() => new Map<string, Blob>()) : new Map();
  return replayGone(load.record, load.missingRefs, (cid) => load.unheld.has(cid) && !here.has(cid));
}

/** Send a recorded job again. Null when it was not sent; the reason is told. */
export async function runAgain(jobId: string): Promise<Job | null> {
  if (busy.has(jobId)) return null;
  busy.add(jobId);
  changed();
  // the job's own uploads, which its toast's Cancel stops
  const abort = new AbortController();
  const id = `run-again-${jobId}`;
  try {
    const load = await loadRecord(jobId);
    if (!load) {
      toast.error(RUN_AGAIN_FAILED, { id, description: reasonText("noRecord") });
      return null;
    }
    const { record } = load;
    const problem = replayProblem({
      domain: record.domain,
      missingRefs: load.missingRefs.length,
      hasInputs: record.inputs !== null,
    });
    if (problem === "processNow" || problem === "gone") {
      toast.error(RUN_AGAIN_FAILED, { id, description: reasonText(problem) });
      return null;
    }
    const gone = problem === "remake" ? await goneForGood(load) : null;
    if (gone) {
      toast.error(RUN_AGAIN_FAILED, { id, description: replayMissingText(gone) });
      return null;
    }
    const type = record.request["type"];
    const first =
      record.checkpoint && typeof type === "string" && LOCAL.has(type)
        ? await modelFirst(record.checkpoint)
        : null;
    const batch = new UploadBatch("Run again", {
      signal: abort.signal,
      onProgress: (p) => {
        if (p.phase !== "claiming" && p.files > 0) {
          toast.loading(batchText(p.done, p.files, p.sent, p.total), {
            id,
            cancel: { label: CANCEL, onClick: () => abort.abort() },
          });
        }
      },
    });
    const job = await submitJob(replaySubmission(load, batch));
    const loads = first
      ? { model: first }
      : typeof type === "string"
        ? loadsModel(type, record.request)
        : null;
    toast.success(runAgainQueuedText(loads), { id, cancel: undefined });
    return job;
  } catch (err) {
    if (err instanceof UserAbortError) {
      toast.info(UPLOAD_CANCELLED, { id, cancel: undefined });
      return null;
    }
    toast.error(RUN_AGAIN_FAILED, {
      id,
      cancel: undefined,
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
