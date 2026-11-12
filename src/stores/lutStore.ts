import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DB, RECORD, STATE_STORE } from "@/lib/profile/names";
import { createIdbStorage } from "@/lib/idbStorage";
import { migratePendingLuts, type LutPlace, type PendingLut, type PendingLuts } from "@/lib/lut";
import { reportStorageProblem } from "@/lib/storageHealth";
import { writeProblems } from "@/inputs/quota";

/** The bytes of each view's color LUT, kept until the server holds them; the
 * settings name a LUT by its name and the hash of these bytes. */
interface LutState {
  images: PendingLut | null;
  process: PendingLut | null;
  setPending: (where: LutPlace, pending: PendingLut | null) => void;
}

const lutStorage = createIdbStorage<PendingLuts>(DB.colorLut, STATE_STORE, {
  ...writeProblems("color-lut", "color LUT", () => lutStorage.retry()),
});

let settle: () => void = () => {};
const settled = new Promise<void>((resolve) => {
  settle = resolve;
});

/** Resolves once the stored bytes are in, or the user chose to go on without them. */
export function lutsSettled(): Promise<void> {
  return settled;
}

export const useLutStore = create<LutState>()(
  persist(
    (set) => ({
      images: null,
      process: null,
      setPending: (where, pending) => set({ [where]: pending }),
    }),
    {
      name: RECORD.colorLut,
      storage: lutStorage,
      version: 2,
      onRehydrateStorage: () => (_state, error) => {
        if (!error) {
          reportStorageProblem({ kind: "resolved", id: "color-lut" });
          settle();
          return;
        }
        reportStorageProblem({
          kind: "read",
          id: "color-lut",
          what: "color LUT",
          retry: () => void useLutStore.persist.rehydrate(),
          startEmpty: () => {
            lutStorage.startEmpty();
            settle();
          },
        });
      },
      migrate: migratePendingLuts,
      partialize: (state): PendingLuts => ({ images: state.images, process: state.process }),
    },
  ),
);

/** Whether the stored bytes have been read: until then none count as here. */
export function useLutsHydrated(): boolean {
  return useSyncExternalStore(
    (changed) => useLutStore.persist.onFinishHydration(changed),
    () => useLutStore.persist.hasHydrated(),
  );
}
