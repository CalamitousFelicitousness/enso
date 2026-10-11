import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { recordKey, retryUnlessRefused } from "@/api/queryKeys";
import { loadFacts } from "@/inputs/facts";
import type { FactsState } from "@/lib/jobs/cardActions";

/** A failed read, where the server says why it has no records to give. */
function failedState(err: unknown): FactsState {
  if (err instanceof ApiError) {
    if (err.status === 503 && err.code === "media_store_off") return "off";
    // a server from before the records keeps no such route
    if (err.status === 404) return "older";
  }
  return "error";
}

/** What is known of a job's record: read once per id and kept current by the
 * records events. */
export function useJobFact(id: string | null | undefined): FactsState {
  const query = useQuery({
    queryKey: recordKey(id ?? ""),
    queryFn: () => loadFacts(id ?? ""),
    enabled: Boolean(id),
    staleTime: Infinity,
    retry: retryUnlessRefused,
  });
  if (!id) return "none";
  if (query.isPending) return "loading";
  if (query.isError) return failedState(query.error);
  return query.data ?? "none";
}
