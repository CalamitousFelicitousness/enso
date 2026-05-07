import { useCallback } from "react";
import { toast } from "sonner";
import { useSubmitJob } from "@/api/hooks/useJobs";
import {
  useJobQueueStore,
  strippedSnapshot,
  type JobDomain,
  type JobSnapshot,
} from "@/stores/jobStore";
import { putJobPayload } from "@/lib/jobPayloadDb";
import type { Job, JobRequest } from "@/api/types/v2";

interface ResubmitArgs {
  domain: JobDomain;
  request: JobRequest;
  snapshot: JobSnapshot;
}

interface ResubmitOptions {
  successMessage?: string;
  errorMessage?: string;
}

/**
 * Submit an existing JobRequest as a new job, tracking it in the queue store
 * and persisting its payload for future retries. Used by QueueTab retry/
 * duplicate and HistoryTab retry — the call sites differ only in toast copy.
 */
export function useResubmitJob() {
  const submitJob = useSubmitJob();
  const trackJob = useJobQueueStore((s) => s.trackJob);

  return useCallback(
    async (
      { domain, request, snapshot }: ResubmitArgs,
      opts: ResubmitOptions = {},
    ): Promise<Job | null> => {
      const priority = (request as { priority?: number }).priority ?? 0;
      try {
        const newJob = await submitJob.mutateAsync(request);
        trackJob(newJob.id, domain, snapshot, request, priority);
        void putJobPayload({
          id: newJob.id,
          domain,
          request,
          priority,
          snapshot: strippedSnapshot(snapshot),
          createdAt: Date.now(),
        });
        if (opts.successMessage) toast.success(opts.successMessage);
        return newJob;
      } catch (err) {
        toast.error(opts.errorMessage ?? "Failed to submit job", {
          description: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
    [submitJob, trackJob],
  );
}
