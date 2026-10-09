import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createIdbStorage } from "@/lib/idbStorage";
import { reportStorageProblem } from "@/lib/storageHealth";
import { writeProblems } from "@/inputs/quota";

/** The color LUT the Color tab names: its bytes stay here and go up with each job. */
interface LutState {
  file: File | null;
  setFile: (file: File | null) => void;
}

interface PersistedLutState {
  file: File | null;
}

const lutStorage = createIdbStorage<PersistedLutState>("enso-color-lut", "state", {
  ...writeProblems("color-lut", "color LUT", () => lutStorage.retry()),
});

export const useLutStore = create<LutState>()(
  persist(
    (set) => ({
      file: null,
      setFile: (file) => set({ file }),
    }),
    {
      name: "enso-color-lut",
      storage: lutStorage,
      version: 1,
      onRehydrateStorage: () => (_state, error) => {
        if (!error) {
          reportStorageProblem({ kind: "resolved", id: "color-lut" });
          return;
        }
        reportStorageProblem({
          kind: "read",
          id: "color-lut",
          what: "color LUT",
          retry: () => void useLutStore.persist.rehydrate(),
          startEmpty: () => lutStorage.startEmpty(),
        });
      },
      partialize: (state): PersistedLutState => ({ file: state.file }),
    },
  ),
);

export const LUT_MISSING_TEXT =
  "The color LUT is no longer stored in this browser. Pick it again in the Color tab, or remove it.";

/** The stored LUT when it is the one the settings name. */
export function namedLut(name: string): File | null {
  const { file } = useLutStore.getState();
  return name && file?.name === name ? file : null;
}
