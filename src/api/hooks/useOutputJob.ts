import { useQuery } from "@tanstack/react-query";
import { outputJob } from "../outputs";
import { outputJobKey, retryUnlessRefused } from "../queryKeys";

/** The job that made a Gallery file, read while its panel or menu shows it.
 * A finished job can name a file that named none before, so the job tracker
 * reads these again when a job completes. */
export function useOutputJob(path: string | null) {
  return useQuery({
    queryKey: outputJobKey(path ?? ""),
    queryFn: () => outputJob(path ?? ""),
    enabled: Boolean(path),
    staleTime: 10_000,
    retry: retryUnlessRefused,
  });
}
