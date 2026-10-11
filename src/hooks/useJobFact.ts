import { useQuery } from "@tanstack/react-query";
import { recordKey, retryUnlessRefused } from "@/api/queryKeys";
import { loadFacts } from "@/inputs/facts";
import type { FactsState } from "@/lib/jobs/cardActions";

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
  if (query.isError) return "error";
  return query.data ?? "none";
}
