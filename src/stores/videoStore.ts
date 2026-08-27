import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { VideoResult } from "@/api/types/video";
import { createIdbListDb } from "@/lib/idbListDb";
import { evict, MAX_PINNED } from "@/lib/video/history";
import { normalizeCodecOptions } from "@/lib/videoOutputPresets";
import {
  VIDEO_PARAMS,
  VIDEO_PARAM_DEFAULTS,
  VIDEO_PARAM_KEYS,
  coerce,
  type VideoParamKey,
  type VideoParamValues,
} from "@/lib/video/paramRegistry";

export const videoHistoryDb = createIdbListDb<VideoResult>({
  dbName: "SDNextVideoHistory",
  storeName: "results",
  sortKey: "timestamp",
});

interface VideoState extends VideoParamValues {
  // Input images live on videoCanvasStore; engine + model live on
  // modelSelectionStore.activeModel.

  // Result history
  results: VideoResult[];
  selectedResultId: string | null;
  historyLimit: number;
  /** False until the stored history has been merged in. Eviction waits for
   * it: before then this list is not a superset of the database. Not
   * persisted. */
  hydrated: boolean;

  /** The pair under comparison. Intent only - a comparison renders when both
   * slots resolve to a result, so nothing has to close it on eviction. Not
   * persisted. */
  compareA: string | null;
  compareB: string | null;
  compareOpen: boolean;

  /** Params the user explicitly changed since the last defaults
   * application; drives the model-switch defaults policy. Not persisted -
   * reseeded on rehydrate as "differs from the registry default". */
  touched: ReadonlySet<VideoParamKey>;

  setParam: <K extends keyof VideoState>(key: K, value: VideoState[K]) => void;
  setParams: (params: Partial<VideoState>) => void;
  applyCapsDefaults: (params: Partial<VideoParamValues>) => void;
  addResult: (result: VideoResult) => void;
  selectResult: (id: string | null) => void;
  removeResult: (id: string) => void;
  clearResults: () => void;
  /** False when the pin was refused because the working set is full. */
  togglePin: (id: string) => boolean;
  setHistoryLimit: (limit: number) => void;
  setCompareSlot: (slot: CompareSlot, id: string | null) => void;
  sendToCompare: (id: string) => void;
  swapCompare: () => void;
  clearCompare: () => void;
  setCompareOpen: (open: boolean) => void;
  reset: () => void;
}

export type CompareSlot = "A" | "B";

function isParamKey(key: string): key is VideoParamKey {
  return key in VIDEO_PARAMS;
}

function withTouched(
  touched: ReadonlySet<VideoParamKey>,
  keys: string[],
): ReadonlySet<VideoParamKey> {
  const fresh = keys.filter((k): k is VideoParamKey => isParamKey(k) && !touched.has(k));
  if (fresh.length === 0) return touched;
  const next = new Set(touched);
  for (const k of fresh) next.add(k);
  return next;
}

export const useVideoStore = create<VideoState>()(
  persist(
    (set, get) => ({
      ...VIDEO_PARAM_DEFAULTS,

      results: [],
      selectedResultId: null,
      historyLimit: 50,
      hydrated: false,
      compareA: null,
      compareB: null,
      compareOpen: false,
      touched: new Set<VideoParamKey>(),

      setParam: (key, value) =>
        set((s) => ({ [key]: value, touched: withTouched(s.touched, [key]) })),
      setParams: (params) =>
        set((s) => ({ ...params, touched: withTouched(s.touched, Object.keys(params)) })),

      applyCapsDefaults: (params) =>
        set((s) => {
          const touched = new Set(s.touched);
          for (const key of Object.keys(params)) {
            if (isParamKey(key)) touched.delete(key);
          }
          return { ...params, touched };
        }),

      addResult: (result) =>
        set((state) => {
          const rows = [result, ...state.results];
          if (!state.hydrated) {
            void videoHistoryDb.put(result);
            return { results: rows, selectedResultId: result.id };
          }
          const retained = new Set([result.id, state.compareA, state.compareB].filter(Boolean));
          const { keep, drop } = evict(rows, state.historyLimit, retained);
          void videoHistoryDb
            .put(result)
            .then(() =>
              drop.length > 0 ? videoHistoryDb.retain(new Set(keep.map((r) => r.id))) : undefined,
            );
          return { results: keep, selectedResultId: result.id };
        }),

      selectResult: (id) => set({ selectedResultId: id }),

      removeResult: (id) =>
        set((state) => {
          const index = state.results.findIndex((r) => r.id === id);
          if (index < 0) return state;
          const results = state.results.filter((r) => r.id !== id);
          void videoHistoryDb.delete(id);
          return {
            results,
            // Take whatever slid into the freed slot, else the row above it.
            selectedResultId:
              state.selectedResultId === id
                ? (results[index]?.id ?? results[index - 1]?.id ?? null)
                : state.selectedResultId,
            compareA: state.compareA === id ? null : state.compareA,
            compareB: state.compareB === id ? null : state.compareB,
          };
        }),

      clearResults: () =>
        set((state) => {
          const keep = state.results.filter((r) => r.pinned);
          const alive = new Set(keep.map((r) => r.id));
          if (state.hydrated) void videoHistoryDb.retain(alive);
          return {
            results: keep,
            selectedResultId:
              state.selectedResultId && alive.has(state.selectedResultId)
                ? state.selectedResultId
                : (keep[0]?.id ?? null),
            compareA: state.compareA && alive.has(state.compareA) ? state.compareA : null,
            compareB: state.compareB && alive.has(state.compareB) ? state.compareB : null,
          };
        }),

      togglePin: (id) => {
        const state = get();
        const target = state.results.find((r) => r.id === id);
        if (!target) return false;
        if (!target.pinned && state.results.filter((r) => r.pinned).length >= MAX_PINNED) {
          return false;
        }
        const next = { ...target, pinned: !target.pinned };
        void videoHistoryDb.put(next);
        // Every other row keeps its identity so memoized tiles skip the render.
        set({ results: state.results.map((r) => (r.id === id ? next : r)) });
        return true;
      },

      setHistoryLimit: (limit) => set({ historyLimit: limit }),

      setCompareSlot: (slot, id) =>
        set((state) => {
          // A result cannot sit in both slots.
          const duplicate = id !== null && (slot === "A" ? state.compareB : state.compareA) === id;
          return slot === "A"
            ? { compareA: id, compareB: duplicate ? null : state.compareB }
            : { compareB: id, compareA: duplicate ? null : state.compareA };
        }),

      // A is the incumbent and B the challenger, so a fresh take lands in B
      // and Swap is what promotes it.
      sendToCompare: (id) =>
        set((state) => {
          if (state.compareA === id || state.compareB === id) return state;
          if (state.compareA === null)
            return { compareA: id, compareOpen: state.compareB !== null };
          return { compareB: id, compareOpen: true };
        }),

      swapCompare: () => set((state) => ({ compareA: state.compareB, compareB: state.compareA })),

      clearCompare: () => set({ compareA: null, compareB: null, compareOpen: false }),

      setCompareOpen: (open) => set({ compareOpen: open }),

      reset: () => set({ ...VIDEO_PARAM_DEFAULTS, touched: new Set<VideoParamKey>() }),
    }),
    {
      name: "enso-video",
      version: 7,
      partialize: (state) => {
        const p: Record<string, unknown> = {};
        for (const key of VIDEO_PARAM_KEYS) {
          p[key] = state[key];
        }
        p["historyLimit"] = state.historyLimit;
        return p;
      },
      // Keep every persisted key that is still a registry param and still
      // type-checks; drop the rest. Param adds/removes need no version bump;
      // a key whose meaning changes needs an explicit branch keyed on the
      // from-version.
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const key of VIDEO_PARAM_KEYS) {
          const v = coerce(VIDEO_PARAMS[key].kind, p[key]);
          if (v !== undefined) out[key] = v;
        }
        // v7: codec option assignments moved from "crf:16" to "crf=16"
        if (typeof out["codecOptions"] === "string") {
          out["codecOptions"] = normalizeCodecOptions(out["codecOptions"]);
        }
        if (typeof p["historyLimit"] === "number") out["historyLimit"] = p["historyLimit"];
        return out;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<VideoState>;
        // Persisted values that differ from the registry default are presumed
        // user-touched; touched itself is never persisted.
        const touched = new Set<VideoParamKey>();
        for (const key of VIDEO_PARAM_KEYS) {
          if (key in p && JSON.stringify(p[key]) !== JSON.stringify(VIDEO_PARAM_DEFAULTS[key])) {
            touched.add(key);
          }
        }
        return { ...current, ...p, touched };
      },
    },
  ),
);
