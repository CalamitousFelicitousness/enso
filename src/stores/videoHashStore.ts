import { create } from "zustand";
import { persist } from "zustand/middleware";

/** The hash the server holds each video canvas file under, by the canvas's
 * frame and reference ids, so a reload claims the files instead of sending
 * them again. Its own record: every write of the canvas's copies its Files. */
interface VideoHashState {
  hashes: Readonly<Record<string, string>>;
  remember: (id: string, hash: string) => void;
  /** Drop the hashes of ids the canvas no longer holds. */
  retain: (ids: readonly string[]) => void;
}

export const useVideoHashStore = create<VideoHashState>()(
  persist(
    (set) => ({
      hashes: {},
      remember: (id, hash) =>
        set((s) => (s.hashes[id] === hash ? s : { hashes: { ...s.hashes, [id]: hash } })),
      retain: (ids) =>
        set((s) => {
          const keep = new Set(ids);
          const kept = Object.entries(s.hashes).filter(([id]) => keep.has(id));
          return kept.length === Object.keys(s.hashes).length
            ? s
            : { hashes: Object.fromEntries(kept) };
        }),
    }),
    { name: "enso-video-hashes", partialize: (s) => ({ hashes: s.hashes }) },
  ),
);
