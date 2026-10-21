// What a view offers for a job named by a file: its record's facts, its
// four actions with their reasons, and the actions themselves. The restores
// land in the Images view, which opens.

import { useQuery } from "@tanstack/react-query";
import { recordKey, retryUnlessRefused } from "@/api/queryKeys";
import { loadRecord } from "@/inputs/jobs";
import {
  gallerySlots,
  type FactsState,
  type GalleryAction,
  type OutputJobLookup,
  type Slot,
} from "@/lib/jobs/cardActions";
import { isTerminal, isVideoDomain } from "@/lib/jobs/domains";
import { loadsModel } from "@/lib/jobs/requests";
import { failedWith } from "@/lib/mediaFiles";
import { recordTarget, restoreFrom } from "@/lib/request/restore";
import { useJobQueueStore } from "@/stores/jobStore";
import { useJobFact } from "./useJobFact";
import { useRunAgain } from "./useRunAgain";
import { saveRecipe } from "@/inputs/recipes";

export interface JobActions {
  facts: FactsState;
  slots: Slot<GalleryAction>[];
  act: Record<GalleryAction, () => void>;
  /** Run again is under way. */
  busy: boolean;
}

/** A video job's request, for the model its Run again loads: the facts
 * cannot tell a local video job from a cloud one. */
function useVideoRequest(jobId: string | null, video: boolean): Record<string, unknown> | null {
  return (
    useQuery({
      queryKey: [...recordKey(jobId ?? ""), "request"],
      queryFn: async () => (await loadRecord(jobId ?? ""))?.record.request ?? null,
      enabled: video && jobId !== null,
      staleTime: Infinity,
      retry: retryUnlessRefused,
    }).data ?? null
  );
}

/** `path` and `seed` name the file a recipe is saved from and the seed its
 * picture's metadata gives, for a job whose row has gone. */
export function useJobActions(
  lookup: OutputJobLookup,
  file: { path: string; seed: number | null } | null = null,
): JobActions {
  const jobId = lookup.state === "found" ? lookup.id : null;
  const facts = useJobFact(jobId);
  const running = useJobQueueStore((s) => {
    const job = jobId ? s.jobs.get(jobId) : undefined;
    return job !== undefined && !isTerminal(job.status);
  });
  const request = useVideoRequest(jobId, typeof facts !== "string" && isVideoDomain(facts.domain));
  const type = request?.["type"];
  const loads = typeof type === "string" ? loadsModel(type, request) : null;
  const { runAgain, isRunning } = useRunAgain();
  const restore = (kind: "inputs" | "both") => () => {
    if (!jobId) return;
    restoreFrom(recordTarget(jobId), kind, true).catch(
      failedWith("Could not restore the job's inputs"),
    );
  };
  return {
    facts,
    slots: gallerySlots({ lookup, running, loads }, facts),
    act: {
      restoreInputs: restore("inputs"),
      restoreBoth: restore("both"),
      saveRecipe: () => {
        if (jobId && file)
          void saveRecipe({ kind: "file", jobId, path: file.path, seed: file.seed });
      },
      runAgain: () => {
        if (jobId) void runAgain(jobId);
      },
    },
    busy: jobId ? isRunning(jobId) : false,
  };
}
