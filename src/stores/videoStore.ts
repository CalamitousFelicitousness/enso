import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { VideoResult } from "@/api/types/video";
import { createIdbListDb } from "@/lib/idbListDb";
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
  // Shared input images (File objects, not persisted to localStorage).
  // Engine + model live on modelSelectionStore.activeModel.
  initImage: File | null;
  lastImage: File | null;

  // Result history
  results: VideoResult[];
  selectedResultId: string | null;
  historyLimit: number;

  /** Params the user explicitly changed since the last defaults
   * application; drives the model-switch defaults policy. Not persisted -
   * reseeded on rehydrate as "differs from the registry default". */
  touched: ReadonlySet<VideoParamKey>;

  setParam: <K extends keyof VideoState>(key: K, value: VideoState[K]) => void;
  setParams: (params: Partial<VideoState>) => void;
  applyCapsDefaults: (params: Partial<VideoParamValues>) => void;
  addResult: (result: VideoResult) => void;
  selectResult: (id: string | null) => void;
  clearResults: () => void;
  setHistoryLimit: (limit: number) => void;
  reset: () => void;
}

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
    (set) => ({
      ...VIDEO_PARAM_DEFAULTS,

      initImage: null as File | null,
      lastImage: null as File | null,

      results: [],
      selectedResultId: null,
      historyLimit: 50,
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
          void videoHistoryDb.put(result).then(() => videoHistoryDb.trim(state.historyLimit));
          return {
            results: [result, ...state.results].slice(0, state.historyLimit),
            selectedResultId: result.id,
          };
        }),

      selectResult: (id) => set({ selectedResultId: id }),

      clearResults: () => {
        void videoHistoryDb.clear();
        set({ results: [], selectedResultId: null });
      },

      setHistoryLimit: (limit) => set({ historyLimit: limit }),

      reset: () => set({ ...VIDEO_PARAM_DEFAULTS, touched: new Set<VideoParamKey>() }),
    }),
    {
      name: "enso-video",
      version: 6,
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
