import { useQuery } from "@tanstack/react-query";
import { MY_RECORDS_KEY, retryUnlessRefused } from "@/api/queryKeys";
import { clientRecords } from "@/api/records";
import { clientId } from "@/inputs/client";

/** This browser's job records on the server, for what a lower cap would retire. */
export function useMyRecords(enabled = true) {
  return useQuery({
    queryKey: MY_RECORDS_KEY,
    queryFn: async () => clientRecords(await clientId()),
    staleTime: 60_000,
    retry: retryUnlessRefused,
    enabled,
  });
}
