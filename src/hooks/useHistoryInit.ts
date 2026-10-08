import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  useGenerationStore,
  generationHistoryDb,
  markHistoryHydrated,
} from "@/stores/generationStore";
import { useVideoStore, videoHistoryDb } from "@/stores/videoStore";
import { HISTORY_UNREAD, HISTORY_UNREAD_DETAIL } from "@/lib/jobs/text";
import { splitAtLimit } from "@/lib/resultStrip";

/**
 * Fold the stored history into whatever the store already holds.
 *
 * A job can complete before the read resolves, and replacing the array
 * outright would drop that result and move the selection off it.
 */
function mergeById<T extends { id: string; timestamp: number }>(stored: T[], live: T[]): T[] {
  if (live.length === 0) return stored;
  const seen = new Set(live.map((r) => r.id));
  return [...live, ...stored.filter((r) => !seen.has(r.id))].sort(
    (a, b) => b.timestamp - a.timestamp,
  );
}

export function useHistoryInit() {
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    const images = generationHistoryDb.getAll().then((stored) => {
      useGenerationStore.setState((s) => {
        const { kept: results } = splitAtLimit(mergeById(stored, s.results), s.historyLimit);
        if (s.selectedResultId) return { results };
        return {
          results,
          selectedResultId: results[0]?.id ?? null,
          selectedImageIndex: results[0] ? 0 : null,
        };
      });
    });

    const videos = videoHistoryDb.getAll().then((stored) => {
      useVideoStore.setState((s) => ({
        results: mergeById(stored, s.results),
        selectedResultId: s.selectedResultId ?? stored[0]?.id ?? null,
        hydrated: true,
      }));
    });

    // A history that could not be read is neither trimmed nor routed into this session
    Promise.all([images, videos]).then(
      () => markHistoryHydrated(true),
      (err: unknown) => {
        console.error("[history] the stored results could not be read", err);
        toast.warning(HISTORY_UNREAD, { description: HISTORY_UNREAD_DETAIL });
        markHistoryHydrated(false);
      },
    );
  }, []);
}
