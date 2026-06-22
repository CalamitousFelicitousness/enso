import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PromptHistoryEntry {
  id: string;
  prompt: string;
  negative: string;
  /** Display metadata only - restore-all does not switch the active model. */
  model: string;
  width: number;
  height: number;
  steps: number;
  pinned: boolean;
  timestamp: number;
}

/** The fields a caller supplies; id/pinned/timestamp are assigned on insert. */
export type PromptHistoryDraft = Omit<PromptHistoryEntry, "id" | "pinned" | "timestamp">;

interface PromptHistoryState {
  history: PromptHistoryEntry[];
  limit: number;
  addEntry: (draft: PromptHistoryDraft) => void;
  togglePin: (id: string) => void;
  remove: (id: string) => void;
  /** Removes everything except pinned entries. */
  clear: () => void;
}

export const usePromptHistoryStore = create<PromptHistoryState>()(
  persist(
    (set) => ({
      history: [],
      limit: 60,

      addEntry: (draft) =>
        set((state) => {
          const prompt = draft.prompt.trim();
          if (!prompt) return state;
          // Dedupe against the newest unpinned entry so repeated Generate
          // clicks on the same prompt don't stack identical rows.
          const topUnpinned = state.history.find((h) => !h.pinned);
          if (topUnpinned && topUnpinned.prompt === prompt) return state;
          const entry: PromptHistoryEntry = {
            ...draft,
            prompt,
            id: crypto.randomUUID(),
            pinned: false,
            timestamp: Date.now(),
          };
          // Pinned entries float to the front; new entry leads the rest.
          const pinned = state.history.filter((h) => h.pinned);
          const rest = state.history.filter((h) => !h.pinned);
          return { history: [...pinned, entry, ...rest].slice(0, state.limit) };
        }),

      togglePin: (id) =>
        set((state) => ({
          history: state.history.map((h) => (h.id === id ? { ...h, pinned: !h.pinned } : h)),
        })),

      remove: (id) => set((state) => ({ history: state.history.filter((h) => h.id !== id) })),

      clear: () => set((state) => ({ history: state.history.filter((h) => h.pinned) })),
    }),
    { name: "enso-prompt-history" },
  ),
);
