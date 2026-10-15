import { create } from "zustand";

interface RestoreDialogState {
  /** The strip result the Restore dialog is open on. */
  target: { resultId: string; imageIndex: number } | null;
  open: (resultId: string, imageIndex: number) => void;
  close: () => void;
}

export const useRestoreDialogStore = create<RestoreDialogState>()((set) => ({
  target: null,
  open: (resultId, imageIndex) => set({ target: { resultId, imageIndex } }),
  close: () => set({ target: null }),
}));
