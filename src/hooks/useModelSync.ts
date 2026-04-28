import { useEffect, useRef } from "react";
import { useCurrentCheckpoint, useModelList } from "@/api/hooks/useModels";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import type { LocalModel } from "@/api/types/cloud";

export function useModelSync() {
  const { data: checkpoint } = useCurrentCheckpoint();
  const { data: models } = useModelList();
  const { activeModel, selectLocal } = useModelSelectionStore();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    if (!checkpoint?.title || !models?.length) return;
    if (activeModel) {
      initialized.current = true;
      return;
    }

    const match = models.find((m) => m.title === checkpoint.title);
    if (match) {
      selectLocal({ ...match, source: "local" } as LocalModel);
    }
    initialized.current = true;
  }, [checkpoint?.title, models, activeModel, selectLocal]);
}
