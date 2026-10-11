import { create } from "zustand";
import { persist } from "zustand/middleware";
import { legacyLutPair, NO_LUT, type LutPair } from "@/lib/lut";

/** The Process view's color LUT: its name and the hash the server holds its
 * bytes under. A record of its own: an older build reads `enso-process` and
 * sends any key its grading params gain. */
interface ProcessLutState extends LutPair {
  set: (pair: LutPair) => void;
}

/** The LUT an older build's `enso-process` names, as a bare upload ref. */
function legacySeed(): LutPair | null {
  try {
    const raw = localStorage.getItem("enso-process");
    const saved = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const state = saved?.["state"] as
      { sections?: { grading?: { params?: { lut_cube_file?: unknown } } } } | undefined;
    return legacyLutPair(state?.sections?.grading?.params?.lut_cube_file);
  } catch {
    return null;
  }
}

export const useProcessLutStore = create<ProcessLutState>()(
  persist(
    (set) => ({
      ...NO_LUT,
      set: (pair) => set({ name: pair.name, hash: pair.hash }),
    }),
    {
      name: "enso-process-lut",
      partialize: (s): LutPair => ({ name: s.name, hash: s.hash }),
      merge: (persisted, current) => ({
        ...current,
        ...((persisted as LutPair | undefined) ?? legacySeed() ?? NO_LUT),
      }),
    },
  ),
);
