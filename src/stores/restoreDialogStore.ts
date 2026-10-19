import { create } from "zustand";

/** What the Restore dialog is open on: a strip result at an image, or a job by its id. */
export type RestoreSource =
  { kind: "result"; resultId: string; imageIndex: number } | { kind: "job"; jobId: string };

interface RestoreDialogState {
  target: RestoreSource | null;
  open: (target: RestoreSource) => void;
  openResult: (resultId: string, imageIndex: number) => void;
  close: () => void;
}

export const useRestoreDialogStore = create<RestoreDialogState>()((set) => ({
  target: null,
  open: (target) => set({ target }),
  openResult: (resultId, imageIndex) => set({ target: { kind: "result", resultId, imageIndex } }),
  close: () => set({ target: null }),
}));
