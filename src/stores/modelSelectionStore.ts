import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UnifiedModel } from "@/api/types/cloud";

interface ModelSelectionState {
  activeModel: UnifiedModel | null;
  setActiveModel: (model: UnifiedModel | null) => void;
  clear: () => void;
}

export const useModelSelectionStore = create<ModelSelectionState>()(
  persist(
    (set) => ({
      activeModel: null,

      setActiveModel: (model) => set({ activeModel: model }),

      clear: () => set({ activeModel: null }),
    }),
    {
      name: "enso-model-selection",
      // Strip the old `isCloud` / `cloudModelId` / `cloudProvider` / `localModelTitle`
      // fields that earlier versions persisted. `activeModel.source` is now the sole
      // discriminator.
      merge: (persisted, current) => {
        const p = persisted as Partial<ModelSelectionState> | undefined;
        return {
          ...current,
          activeModel: p?.activeModel ?? null,
        };
      },
    },
  ),
);
