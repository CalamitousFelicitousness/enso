import { useQuery } from "@tanstack/react-query";
import { LEGACY_ENTRIES_KEY } from "@/api/queryKeys";
import { legacyEntries } from "@/inputs/legacyRecords";
import { inputsReady } from "@/stores/inputStore";

/** An older build's library entries, read once the page-start sweep has run. */
export function useLegacyEntries(enabled = true) {
  return useQuery({
    queryKey: LEGACY_ENTRIES_KEY,
    queryFn: async () => {
      await inputsReady();
      return legacyEntries();
    },
    staleTime: Infinity,
    enabled,
  });
}
