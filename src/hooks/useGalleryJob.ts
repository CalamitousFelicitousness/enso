import { useOutputJob } from "@/api/hooks/useOutputJob";
import type { OutputJobLookup } from "@/lib/jobs/cardActions";
import { useJobActions, type JobActions } from "./useJobActions";

/** The job that made a Gallery file, and what can be done with it. */
export function useGalleryJob(path: string | null): JobActions & { lookup: OutputJobLookup } {
  const query = useOutputJob(path);
  const lookup: OutputJobLookup = query.isPending
    ? { state: "loading" }
    : query.isError
      ? { state: "failed" }
      : query.data.job_id
        ? { state: "found", id: query.data.job_id }
        : { state: "none" };
  return { ...useJobActions(lookup), lookup };
}
