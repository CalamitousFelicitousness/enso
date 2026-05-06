import { useQuery } from "@tanstack/react-query";
import { api } from "../client";
import type { JobTypeRuntime, JobTypeV2 } from "../types/v2";

interface UseJobTypesOptions {
  runtime?: JobTypeRuntime;
  enabled?: boolean;
}

export function useJobTypes({ runtime, enabled = true }: UseJobTypesOptions = {}) {
  return useQuery({
    queryKey: ["job-types", runtime ?? "all"],
    queryFn: () => api.get<JobTypeV2[]>("/sdapi/v2/job-types", runtime ? { runtime } : undefined),
    staleTime: 60_000,
    enabled,
  });
}
