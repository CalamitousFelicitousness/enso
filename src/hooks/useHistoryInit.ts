import { useEffect, useRef } from "react";
import { useGenerationStore, generationHistoryDb } from "@/stores/generationStore";
import { useVideoStore, videoHistoryDb } from "@/stores/videoStore";
import { useOptionsSubset } from "@/api/hooks/useSettings";

export function useHistoryInit() {
  const hydrated = useRef(false);
  const setHistoryLimit = useGenerationStore((s) => s.setHistoryLimit);
  const { data: options } = useOptionsSubset(["latent_history"]);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    void generationHistoryDb.getAll().then((results) => {
      if (results.length === 0) return;
      useGenerationStore.setState({
        results,
        selectedResultId: results[0]?.id ?? null,
        selectedImageIndex: results[0] ? 0 : null,
      });
    });

    void videoHistoryDb.getAll().then((results) => {
      if (results.length === 0) return;
      useVideoStore.setState({
        results,
        selectedResultId: results[0]?.id ?? null,
      });
    });
  }, []);

  useEffect(() => {
    if (options?.["latent_history"] != null) {
      setHistoryLimit(Number(options["latent_history"]));
    }
  }, [options, setHistoryLimit]);
}
