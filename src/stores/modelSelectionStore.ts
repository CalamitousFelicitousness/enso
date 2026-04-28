import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CloudModel, LocalModel, UnifiedModel } from "@/api/types/cloud";

interface ModelSelectionState {
  activeModel: UnifiedModel | null;
  isCloud: boolean;
  cloudModelId: string | null;
  cloudProvider: string | null;
  localModelTitle: string | null;

  selectLocal: (model: LocalModel) => void;
  selectCloud: (model: CloudModel) => void;
  clear: () => void;
}

export const useModelSelectionStore = create<ModelSelectionState>()(
  persist(
    (set) => ({
      activeModel: null,
      isCloud: false,
      cloudModelId: null,
      cloudProvider: null,
      localModelTitle: null,

      selectLocal: (model) =>
        set({
          activeModel: model,
          isCloud: false,
          cloudModelId: null,
          cloudProvider: null,
          localModelTitle: model.title,
        }),

      selectCloud: (model) =>
        set({
          activeModel: model,
          isCloud: true,
          cloudModelId: model.id,
          cloudProvider: model.provider,
          localModelTitle: null,
        }),

      clear: () =>
        set({
          activeModel: null,
          isCloud: false,
          cloudModelId: null,
          cloudProvider: null,
          localModelTitle: null,
        }),
    }),
    {
      name: "enso-model-selection",
      merge: (persisted, current) => {
        const p = persisted as Partial<ModelSelectionState> | undefined;
        return { ...current, ...p, selectLocal: current.selectLocal, selectCloud: current.selectCloud, clear: current.clear };
      },
    },
  ),
);
