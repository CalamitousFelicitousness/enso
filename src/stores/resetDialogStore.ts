import { create } from "zustand";

/** Whether the Reset Enso in this browser dialog is open. */
interface ResetDialogState {
  open: boolean;
  /** Counts the openings, so each starts from the default rows. */
  opened: number;
  openReset: () => void;
  close: () => void;
}

export const useResetDialogStore = create<ResetDialogState>()((set) => ({
  open: false,
  opened: 0,
  openReset: () => set((s) => ({ open: true, opened: s.opened + 1 })),
  close: () => set({ open: false }),
}));
