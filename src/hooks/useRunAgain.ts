// Run a job again from its record: every upload is staged under the hash it
// went out with, so the server's copies go as they are and only what it lacks
// is made again from the record's frames. The request goes out as it was
// sent, on whatever model is loaded.

import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { queryClient } from "@/api/queryClient";
import type { CheckpointInfoV2 } from "@/api/types/models";
import type { Job } from "@/api/types/v2";
import { readBlobs } from "@/inputs/db";
import { loadRecord, replaySubmission, type RecordLoad } from "@/inputs/jobs";
import { submitJob } from "@/inputs/submit";
import { UploadBatch } from "@/inputs/uploads";
import { replayGone, replayProblem } from "@/lib/jobs/replay";
import {
  OTHER_MODEL,
  otherModelText,
  reasonText,
  RUN_AGAIN_FAILED,
  RUN_AGAIN_QUEUED,
} from "@/lib/jobs/text";
import { batchText } from "@/lib/media/text";

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

/** An upload the server lost cannot be made again: its source reads a
 * picture neither the server nor this browser holds. */
async function goneForGood(load: RecordLoad): Promise<boolean> {
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
    if (problem === "video" || problem === "processNow" || problem === "gone") {
      toast.error(RUN_AGAIN_FAILED, { id, description: reasonText(problem) });
      return null;
    }
    if (problem === "remake" && (await goneForGood(load))) {
      toast.error(RUN_AGAIN_FAILED, { id, description: reasonText("gone") });
      return null;
    }
    const type = record.request["type"];
    if (record.checkpoint && typeof type === "string" && LOCAL.has(type)) {
      await noteModel(record.checkpoint);
    }
    const batch = new UploadBatch("Run again", {
      onProgress: (p) => {
        if (p.phase !== "claiming" && p.files > 0) {
          toast.loading(batchText(p.done, p.files, p.sent, p.total), { id });
        }
      },
    });
    const job = await submitJob(replaySubmission(load, batch));
    toast.success(RUN_AGAIN_QUEUED, { id });
    return job;
  } catch (err) {
    toast.error(RUN_AGAIN_FAILED, {
      id,
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
