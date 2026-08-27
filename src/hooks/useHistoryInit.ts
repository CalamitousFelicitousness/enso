import { useEffect, useRef } from "react";
import { useGenerationStore, generationHistoryDb } from "@/stores/generationStore";
import { useVideoStore, videoHistoryDb } from "@/stores/videoStore";
import { useOptionsSubset } from "@/api/hooks/useSettings";

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
  const setHistoryLimit = useGenerationStore((s) => s.setHistoryLimit);
  const { data: options } = useOptionsSubset(["latent_history"]);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    void generationHistoryDb.getAll().then((stored) => {
      useGenerationStore.setState((s) => {
        const results = mergeById(stored, s.results);
        if (s.selectedResultId) return { results };
        return {
          results,
          selectedResultId: results[0]?.id ?? null,
          selectedImageIndex: results[0] ? 0 : null,
        };
      });
    });

    void videoHistoryDb.getAll().then((stored) => {
      useVideoStore.setState((s) => ({
        results: mergeById(stored, s.results),
        selectedResultId: s.selectedResultId ?? stored[0]?.id ?? null,
        hydrated: true,
      }));
    });
  }, []);

  useEffect(() => {
    if (options?.["latent_history"] != null) {
      setHistoryLimit(Number(options["latent_history"]));
    }
  }, [options, setHistoryLimit]);
}
