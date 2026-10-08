import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createIdbListDb } from "@/lib/idbListDb";
import type { MaskStroke } from "@/lib/inputs/types";
import type { DetailerOverrides, DetailerModelEntry, JobWarning } from "@/api/types/v2";
import type { WireParams } from "@/api/types/wireParams";
import { DEFAULT_HIRES_UPSCALER } from "@/lib/hires";
import {
  clampStripLimit,
  migrateGeneration,
  splitAtLimit,
  STRIP_LIMIT_DEFAULT,
  withResult,
} from "@/lib/resultStrip";

export interface GenerationResult {
  /** The job's id; results of older builds keep an id of their own. */
  id: string;
  /** The job that made it; absent on results of older builds. */
  jobId?: string | undefined;
  /** The server's job type; absent on results of older builds, which were generations. */
  type?: string | undefined;
  images: string[];
  parameters: WireParams;
  info: string;
  timestamp: number;
  /** Key of the frames the job was sent with, in the enso-inputs snapshots store. */
  inputsKey?: string | undefined;
  /** Written by older builds: the flattened canvas as base64. */
  inputImage?: string | undefined;
  /** Written by older builds: the mask strokes. */
  inputMask?: MaskStroke[] | undefined;
  /** Written by older builds: control unit settings with base64 pictures. */
  controlUnits?: unknown[] | undefined;
  /** Lines the server logged at warning level or above during the job. */
  warnings?: JobWarning[] | undefined;
}

export const generationHistoryDb = createIdbListDb<GenerationResult>({
  dbName: "SDNextHistory",
  storeName: "results",
  sortKey: "timestamp",
});

let settleHistory: (read: boolean) => void = () => {};
const historyRead = new Promise<boolean>((resolve) => {
  settleHistory = resolve;
});

/** Resolves once the stored history has been merged into the strip: true
 * when it was read, false when the read failed. */
export function historyHydrated(): Promise<boolean> {
  return historyRead;
}

export function markHistoryHydrated(read: boolean): void {
  settleHistory(read);
}

/** Keep the stored history to the strip's limit, once it has been read. */
async function trimStoredHistory(limit: number): Promise<void> {
  if (await historyHydrated()) await generationHistoryDb.trim(limit);
}

export interface GenerationState {
  // Prompt
  prompt: string;
  negativePrompt: string;
  styles: string[];

  // Sampler
  sampler: string;
  steps: number;

  // Resolution
  width: number;
  height: number;

  // Batch
  batchSize: number;
  batchCount: number;

  // Guidance
  cfgScale: number;
  cfgEnd: number;
  guidanceRescale: number;
  imageCfgScale: number;
  pagScale: number;
  pagAdaptive: number;
  seed: number;
  subseed: number;
  subseedStrength: number;
  denoisingStrength: number;

  // Sampler / Scheduler
  sigmaMethod: string;
  timestepSpacing: string;
  betaSchedule: string;
  predictionMethod: string;
  timestepsPreset: string;
  timestepsOverride: string;
  sigmaAdjust: number;
  sigmaAdjustStart: number;
  sigmaAdjustEnd: number;
  flowShift: number;
  baseShift: number;
  maxShift: number;
  lowOrder: boolean;
  thresholding: boolean;
  dynamic: boolean;
  rescale: boolean;

  // Hires Fix
  hiresEnabled: boolean;
  hiresUpscaler: string;
  hiresScale: number;
  hiresSteps: number;
  hiresDenoising: number;
  hiresResizeMode: number;
  hiresSampler: string;
  hiresForce: boolean;
  hiresResizeX: number;
  hiresResizeY: number;
  hiresResizeContext: string;

  // Post-generation upscale (resize_after - pure upscaler, no diffusion)
  upscaleAfterEnabled: boolean;
  upscaleAfterUpscaler: string;
  upscaleAfterScale: number;
  upscaleAfterResizeMode: number; // 0 = scale, 1 = explicit dims
  upscaleAfterWidth: number;
  upscaleAfterHeight: number;

  // Refiner
  refinerEnabled: boolean;
  refinerStart: number;
  refinerSteps: number;
  refinerPrompt: string;
  refinerNegative: string;

  // Advanced
  clipSkip: number;
  vaeType: string;
  tiling: boolean;
  hidiffusion: boolean;
  freeuEnabled: boolean;
  freeuB1: number;
  freeuB2: number;
  freeuS1: number;
  freeuS2: number;
  hypertileUnetEnabled: boolean;
  hypertileHiresOnly: boolean;
  hypertileUnetTile: number;
  hypertileUnetMinTile: number;
  hypertileUnetSwapSize: number;
  hypertileUnetDepth: number;
  hypertileVaeEnabled: boolean;
  hypertileVaeTile: number;
  hypertileVaeSwapSize: number;
  teacacheEnabled: boolean;
  teacacheThresh: number;
  tokenMergingMethod: string;
  tomeRatio: number;
  todoRatio: number;
  overrideSettings: Record<string, unknown>;

  // Detailer (V2 schema: defaults block + per-model entries)
  detailerEnabled: boolean;
  detailerOnly: boolean;
  detailerDefaults: DetailerOverrides;
  detailerModels: DetailerModelEntry[];

  // Color Correction
  colorCorrectionEnabled: boolean;
  colorCorrectionMethod: string;

  // Latent Corrections
  hdrMode: number;
  hdrBrightness: number;
  hdrSharpen: number;
  hdrColor: number;
  hdrClamp: boolean;
  hdrBoundary: number;
  hdrThreshold: number;
  hdrMaximize: boolean;
  hdrMaxCenter: number;
  hdrMaxBoundary: number;
  hdrColorPicker: string;
  hdrTintRatio: number;
  hdrApplyHires: boolean;

  // Color Grading
  gradingBrightness: number;
  gradingContrast: number;
  gradingSaturation: number;
  gradingHue: number;
  gradingGamma: number;
  gradingSharpness: number;
  gradingColorTemp: number;
  gradingShadows: number;
  gradingMidtones: number;
  gradingHighlights: number;
  gradingClaheClip: number;
  gradingClaheGrid: number;
  gradingShadowsTint: string;
  gradingHighlightsTint: string;
  gradingSplitToneBalance: number;
  gradingVignette: number;
  gradingGrain: number;
  gradingLutFile: string;
  gradingLutStrength: number;

  // Results
  results: GenerationResult[];
  selectedResultId: string | null;
  selectedImageIndex: number | null;
  historyLimit: number;

  // Actions
  setParam: <K extends keyof GenerationState>(key: K, value: GenerationState[K]) => void;
  setParams: (params: Partial<GenerationState>) => void;
  /** Put a result in front of the strip, in place of one with its id.
   * Resolves once it is stored. */
  addResult: (result: GenerationResult, options?: { select?: boolean }) => Promise<void>;
  clearResults: () => void;
  selectImage: (resultId: string, imageIndex: number) => void;
  clearSelection: () => void;
  /** Keep this many results; the ones past it leave the strip and are
   * returned, still stored, so they can be put back. */
  setHistoryLimit: (limit: number) => GenerationResult[];
  /** Results a lowered limit took off the strip, back on it under `limit`. */
  putBackResults: (results: GenerationResult[], limit: number) => void;
  reset: () => void;
}

export const defaultParams = {
  prompt: "",
  negativePrompt: "",
  styles: [] as string[],
  sampler: "Euler",
  steps: 20,
  width: 1024,
  height: 1024,
  batchSize: 1,
  batchCount: 1,
  cfgScale: 7,
  cfgEnd: 1,
  guidanceRescale: 0,
  imageCfgScale: 6,
  pagScale: 0,
  pagAdaptive: 0.5,
  seed: -1,
  subseed: -1,
  subseedStrength: 0,
  denoisingStrength: 0.5,
  sigmaMethod: "default",
  timestepSpacing: "default",
  betaSchedule: "default",
  predictionMethod: "default",
  timestepsPreset: "None",
  timestepsOverride: "",
  sigmaAdjust: 1.0,
  sigmaAdjustStart: 0.2,
  sigmaAdjustEnd: 1.0,
  flowShift: 3,
  baseShift: 0.5,
  maxShift: 1.15,
  lowOrder: true,
  thresholding: false,
  dynamic: false,
  rescale: false,
  hiresEnabled: false,
  hiresUpscaler: DEFAULT_HIRES_UPSCALER,
  hiresScale: 2,
  hiresSteps: 0,
  hiresDenoising: 0.5,
  hiresResizeMode: 2,
  hiresSampler: "",
  hiresForce: false,
  hiresResizeX: 0,
  hiresResizeY: 0,
  hiresResizeContext: "None",
  upscaleAfterEnabled: false,
  upscaleAfterUpscaler: "None",
  upscaleAfterScale: 2,
  upscaleAfterResizeMode: 0,
  upscaleAfterWidth: 0,
  upscaleAfterHeight: 0,
  refinerEnabled: false,
  refinerStart: 0,
  refinerSteps: 0,
  refinerPrompt: "",
  refinerNegative: "",
  clipSkip: 1,
  vaeType: "Full",
  tiling: false,
  hidiffusion: false,
  freeuEnabled: false,
  freeuB1: 1.2,
  freeuB2: 1.4,
  freeuS1: 0.9,
  freeuS2: 0.2,
  hypertileUnetEnabled: false,
  hypertileHiresOnly: false,
  hypertileUnetTile: 0,
  hypertileUnetMinTile: 0,
  hypertileUnetSwapSize: 1,
  hypertileUnetDepth: 0,
  hypertileVaeEnabled: false,
  hypertileVaeTile: 128,
  hypertileVaeSwapSize: 1,
  teacacheEnabled: false,
  teacacheThresh: 0.15,
  tokenMergingMethod: "None",
  tomeRatio: 0.0,
  todoRatio: 0.0,
  overrideSettings: {},
  detailerEnabled: false,
  detailerOnly: false,
  detailerDefaults: {
    strength: 0.3,
    steps: 10,
    resolution: 1024,
    padding: 20,
    blur: 10,
    conf: 0.6,
    iou: 0.5,
    min_size: 0.0,
    max_size: 1.0,
    max: 2,
    sigma_adjust: 1.0,
    sigma_adjust_max: 1.0,
    segmentation: false,
    include_detections: false,
    merge: false,
    sort: false,
    prompt: "",
    negative: "",
    classes: "",
    augment: false,
  },
  detailerModels: [{ name: "face-yolo8n" }],
  colorCorrectionEnabled: false,
  colorCorrectionMethod: "histogram",
  hdrMode: 0,
  hdrBrightness: 0,
  hdrSharpen: 0,
  hdrColor: 0,
  hdrClamp: false,
  hdrBoundary: 4.0,
  hdrThreshold: 0.95,
  hdrMaximize: false,
  hdrMaxCenter: 0.6,
  hdrMaxBoundary: 1.0,
  hdrColorPicker: "#000000",
  hdrTintRatio: 0,
  hdrApplyHires: true,
  gradingBrightness: 0,
  gradingContrast: 0,
  gradingSaturation: 0,
  gradingHue: 0,
  gradingGamma: 1.0,
  gradingSharpness: 0,
  gradingColorTemp: 6500,
  gradingShadows: 0,
  gradingMidtones: 0,
  gradingHighlights: 0,
  gradingClaheClip: 0,
  gradingClaheGrid: 8,
  gradingShadowsTint: "#000000",
  gradingHighlightsTint: "#ffffff",
  gradingSplitToneBalance: 0.5,
  gradingVignette: 0,
  gradingGrain: 0,
  gradingLutFile: "",
  gradingLutStrength: 1.0,
};

const defaultParamKeys = Object.keys(defaultParams) as (keyof typeof defaultParams)[];

export const useGenerationStore = create<GenerationState>()(
  persist(
    (set, get) => ({
      ...defaultParams,

      results: [],
      selectedResultId: null,
      selectedImageIndex: null,
      historyLimit: STRIP_LIMIT_DEFAULT,

      setParam: (key, value) => set({ [key]: value }),

      setParams: (params) => set(params),

      addResult: (result, options) => {
        const state = get();
        const { kept } = splitAtLimit(withResult(state.results, result), state.historyLimit);
        set({
          results: kept,
          ...(options?.select === false
            ? {}
            : { selectedResultId: result.id, selectedImageIndex: 0 }),
        });
        const stored = generationHistoryDb.put(result);
        void stored
          .then(() => trimStoredHistory(get().historyLimit))
          .catch((err: unknown) =>
            console.error("[history] could not trim the stored results", err),
          );
        return stored;
      },

      clearResults: () => {
        void generationHistoryDb.clear();
        set({ results: [], selectedResultId: null, selectedImageIndex: null });
      },

      selectImage: (resultId, imageIndex) =>
        set({ selectedResultId: resultId, selectedImageIndex: imageIndex }),

      clearSelection: () => set({ selectedResultId: null, selectedImageIndex: null }),

      setHistoryLimit: (limit) => {
        const historyLimit = clampStripLimit(limit);
        const { kept, removed } = splitAtLimit(get().results, historyLimit);
        set((s) => ({
          historyLimit,
          results: kept,
          ...(kept.some((r) => r.id === s.selectedResultId)
            ? {}
            : { selectedResultId: kept[0]?.id ?? null, selectedImageIndex: kept[0] ? 0 : null }),
        }));
        return removed;
      },

      putBackResults: (results, limit) => {
        for (const result of results) void generationHistoryDb.put(result);
        set((s) => ({
          historyLimit: clampStripLimit(limit),
          results: [
            ...s.results,
            ...results.filter((r) => !s.results.some((x) => x.id === r.id)),
          ].sort((a, b) => b.timestamp - a.timestamp),
        }));
      },

      reset: () => set({ ...defaultParams }),
    }),
    {
      name: "enso-generation",
      version: 4,
      // Every version before 4 took the strip's limit from sdnext's latent cache size
      migrate: (persisted) => migrateGeneration(persisted),
      partialize: (state) => {
        const p: Record<string, unknown> = {};
        for (const key of defaultParamKeys) p[key] = state[key];
        p["historyLimit"] = state.historyLimit;
        return p;
      },
    },
  ),
);
