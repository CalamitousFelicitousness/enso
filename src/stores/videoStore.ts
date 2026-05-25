import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { VideoResult } from "@/api/types/video";
import { createIdbListDb } from "@/lib/idbListDb";

export const videoHistoryDb = createIdbListDb<VideoResult>({
  dbName: "SDNextVideoHistory",
  storeName: "results",
  sortKey: "timestamp",
});

interface VideoState {
  // Shared. Engine + model are not stored here - they live on
  // modelSelectionStore.activeModel as a LocalVideoModel (or a CloudModel
  // for cloud video) and the Video panel reads them from there.
  prompt: string;
  negative: string;
  width: number;
  height: number;
  frames: number;
  steps: number;
  sampler: number;
  samplerShift: number;
  dynamicShift: boolean;
  seed: number;
  guidanceScale: number;
  guidanceTrue: number;
  initStrength: number;
  vaeType: string;
  vaeTileFrames: number;
  fps: number;
  interpolate: number;
  codec: string;
  format: string;
  codecOptions: string;
  outputPreset: string;
  outputQuality: number;
  saveVideo: boolean;
  saveFrames: boolean;
  saveSafetensors: boolean;

  // Shared input images (File objects, not persisted to localStorage)
  initImage: File | null;
  lastImage: File | null;

  // FramePack. fpVariant lives on activeModel; the rest are tunables.
  fpResolution: number;
  fpDuration: number;
  fpLatentWindowSize: number;
  fpSteps: number;
  fpShift: number;
  fpCfgScale: number;
  fpCfgDistilled: number;
  fpCfgRescale: number;
  fpStartWeight: number;
  fpEndWeight: number;
  fpVisionWeight: number;
  fpSectionPrompt: string;
  fpSystemPrompt: string;
  fpTeacache: boolean;
  fpOptimizedPrompt: boolean;
  fpCfgZero: boolean;
  fpPreview: boolean;
  fpAttention: string;
  fpVaeType: string;

  // LTX. ltxModel lives on activeModel; the rest are tunables.
  ltxSteps: number;
  ltxDecodeTimestep: number;
  ltxNoiseScale: number;
  ltxUpsampleEnable: boolean;
  ltxUpsampleRatio: number;
  ltxRefineEnable: boolean;
  ltxRefineStrength: number;
  ltxConditionStrength: number;
  ltxAudioEnable: boolean;

  // Cloud video. Provider + model come from modelSelectionStore.activeModel;
  // these are the operational params the form binds to.
  cloudAspectRatio: string;
  cloudDuration: number;

  // Result history
  results: VideoResult[];
  selectedResultId: string | null;
  historyLimit: number;

  setParam: <K extends keyof VideoState>(key: K, value: VideoState[K]) => void;
  setParams: (params: Partial<VideoState>) => void;
  addResult: (result: VideoResult) => void;
  selectResult: (id: string | null) => void;
  clearResults: () => void;
  setHistoryLimit: (limit: number) => void;
  reset: () => void;
}

const defaultParams = {
  prompt: "",
  negative: "",
  width: 848,
  height: 480,
  frames: 25,
  steps: 30,
  sampler: 0,
  samplerShift: -1,
  dynamicShift: false,
  seed: -1,
  guidanceScale: 6,
  guidanceTrue: -1,
  initStrength: 0.5,
  vaeType: "Default",
  vaeTileFrames: 0,
  fps: 24,
  interpolate: 0,
  codec: "libx264",
  format: "mp4",
  codecOptions: "crf:16",
  outputPreset: "balanced",
  outputQuality: 70,
  saveVideo: true,
  saveFrames: false,
  saveSafetensors: false,

  initImage: null as File | null,
  lastImage: null as File | null,

  fpResolution: 640,
  fpDuration: 4,
  fpLatentWindowSize: 9,
  fpSteps: 25,
  fpShift: 3,
  fpCfgScale: 1,
  fpCfgDistilled: 10,
  fpCfgRescale: 0,
  fpStartWeight: 1,
  fpEndWeight: 1,
  fpVisionWeight: 1,
  fpSectionPrompt: "",
  fpSystemPrompt: "",
  fpTeacache: true,
  fpOptimizedPrompt: true,
  fpCfgZero: false,
  fpPreview: true,
  fpAttention: "Default",
  fpVaeType: "Full",

  ltxSteps: 50,
  ltxDecodeTimestep: 0.05,
  ltxNoiseScale: 0.025,
  ltxUpsampleEnable: false,
  ltxUpsampleRatio: 2,
  ltxRefineEnable: false,
  ltxRefineStrength: 0.4,
  ltxConditionStrength: 0.8,
  ltxAudioEnable: false,

  cloudAspectRatio: "16:9",
  cloudDuration: 5,
};

const defaultParamKeys = Object.keys(defaultParams) as (keyof typeof defaultParams)[];

export const useVideoStore = create<VideoState>()(
  persist(
    (set) => ({
      ...defaultParams,

      results: [],
      selectedResultId: null,
      historyLimit: 50,

      setParam: (key, value) => set({ [key]: value }),
      setParams: (params) => set(params),

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

      reset: () => set({ ...defaultParams }),
    }),
    {
      name: "enso-video",
      version: 5,
      partialize: (state) => {
        const p: Record<string, unknown> = {};
        for (const key of defaultParamKeys) {
          if (key === "initImage" || key === "lastImage") continue;
          p[key] = state[key];
        }
        p["historyLimit"] = state.historyLimit;
        return p;
      },
    },
  ),
);
