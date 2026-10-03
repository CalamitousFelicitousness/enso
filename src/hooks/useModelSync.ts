import { useEffect, useRef } from "react";
import { useCurrentCheckpoint, useModelList } from "@/api/hooks/useModels";
import { followsLoaded } from "@/lib/modelSelection";
import { useModelCapabilityStore } from "@/stores/modelCapabilityStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";

/** Keeps the selection on the server's loaded image model, and remembers what
 * each loaded model reports about its pipeline. */
export function useModelSync() {
  const { data: checkpoint } = useCurrentCheckpoint();
  const { data: models } = useModelList();
  // undefined until the server has reported its loaded model once
  const previousLoaded = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!checkpoint) return;
    useModelCapabilityStore.getState().remember(checkpoint);
    // The list turns the loaded title into a selectable model
    if (!models?.length) return;

    const loadedTitle = checkpoint.loaded ? (checkpoint.title ?? null) : null;
    const previous = previousLoaded.current;
    previousLoaded.current = loadedTitle;
    const { activeModel, setActiveModel } = useModelSelectionStore.getState();
    if (!followsLoaded(loadedTitle, previous, activeModel)) return;
    const match = models.find((m) => m.title === loadedTitle);
    if (match) setActiveModel({ ...match, source: "local" });
  }, [checkpoint, models]);
}
