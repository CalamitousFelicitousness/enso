import { create } from "zustand";

/** What the Restore dialog is open on: a strip result at an image, a job by
 * its id, or a library recipe by its entry's id. */
export type RestoreSource =
  | { kind: "result"; resultId: string; imageIndex: number }
  | { kind: "job"; jobId: string }
  | { kind: "entry"; id: string };

interface RestoreDialogState {
  target: RestoreSource | null;
  open: (target: RestoreSource) => void;
  openResult: (resultId: string, imageIndex: number) => void;
  openEntry: (id: string) => void;
  close: () => void;
}

export const useRestoreDialogStore = create<RestoreDialogState>()((set) => ({
  target: null,
  open: (target) => set({ target }),
  openResult: (resultId, imageIndex) => set({ target: { kind: "result", resultId, imageIndex } }),
  openEntry: (id) => set({ target: { kind: "entry", id } }),
  close: () => set({ target: null }),
}));
