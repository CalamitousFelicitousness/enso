import { create } from "zustand";
import { LOCAL } from "@/lib/profile/names";
import { persistLocal } from "@/profile/local";
import type { UnifiedModel } from "@/api/types/cloud";

interface ModelSelectionState {
  activeModel: UnifiedModel | null;
  setActiveModel: (model: UnifiedModel | null) => void;
  clear: () => void;
}

export const useModelSelectionStore = create<ModelSelectionState>()(
  persistLocal(
    (set) => ({
      activeModel: null,

      setActiveModel: (model) => set({ activeModel: model }),

      clear: () => set({ activeModel: null }),
    }),
    {
      name: LOCAL.modelSelection,
      version: 2,
      // Defensive shape check on rehydrate: discard any persisted activeModel
      // whose `source` isn't one of the three known discriminator values, so
      // a stale session can't poison the rehydrate with an unknown union
      // member that downstream `switch(activeModel.source)` reads would not
      // handle. Runs on every load (merge), independent of version bumps.
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
