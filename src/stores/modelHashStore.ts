import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Download } from "@/lib/recipes/models";

/** The most downloads remembered; the oldest go first. */
const KEPT = 200;

/** Files this browser downloaded from Find on CivitAI, by the digest they were
 * found under: a listed file of that name counts as installed before sdnext
 * has hashed it. */
interface ModelHashState {
  downloads: readonly Download[];
  remember: (download: Download) => void;
}

export const useModelHashStore = create<ModelHashState>()(
  persist(
    (set) => ({
      downloads: [],
      remember: (download) =>
        set((s) => ({
          downloads: [
            ...s.downloads.filter(
              (d) => d.sha256 !== download.sha256 || d.filename !== download.filename,
            ),
            download,
          ].slice(-KEPT),
        })),
    }),
    { name: "enso-model-downloads", partialize: (s) => ({ downloads: s.downloads }) },
  ),
);
