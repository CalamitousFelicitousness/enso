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
      version: 1,
      // Strip the old `isCloud` / `cloudModelId` / `cloudProvider` / `localModelTitle`
      // fields that earlier versions persisted. `activeModel.source` is now the sole
      // discriminator. v1 also discards any persisted activeModel whose source
      // isn't one of the three known kinds, so a downgraded session can't
      // poison rehydrate by leaving an unknown shape behind.
      merge: (persisted, current) => {
        const p = persisted as Partial<ModelSelectionState> | undefined;
        const candidate = p?.activeModel;
        const known =
          candidate &&
          (candidate.source === "local" ||
            candidate.source === "local-video" ||
            candidate.source === "cloud");
        return {
          ...current,
          activeModel: known ? candidate : null,
        };
      },
    },
  ),
);
