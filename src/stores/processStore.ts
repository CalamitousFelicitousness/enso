import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ProcessCreateVideoParams,
  ProcessDetailerParams,
  ProcessDlssParams,
  ProcessGradingParams,
  ProcessMode,
  ProcessNudenetParams,
  ProcessPixelartParams,
  ProcessRembgParams,
  ProcessSeedvrParams,
  ProcessUpscaleParams,
} from "@/api/types/v2";

/** One section per sdnext postprocessing script; params mirror the wire model. */
export interface ProcessSectionParams {
  upscale: ProcessUpscaleParams;
  detailer: ProcessDetailerParams;
  grading: ProcessGradingParams;
  rembg: ProcessRembgParams;
  nudenet: ProcessNudenetParams;
  seedvr: ProcessSeedvrParams;
  pixelart: ProcessPixelartParams;
  dlss: ProcessDlssParams;
  createVideo: ProcessCreateVideoParams;
}

export type ProcessSectionKey = keyof ProcessSectionParams;

export type ProcessSections = {
  [K in ProcessSectionKey]: { enabled: boolean; params: ProcessSectionParams[K] };
};

export interface ProcessResultImage {
  url: string;
  width: number;
  height: number;
}

export interface ProcessResultVideo {
  url: string;
  width: number;
  height: number;
  duration: number | null;
}

export const DEFAULT_SECTIONS: ProcessSections = {
  upscale: {
    enabled: true,
    params: {
      upscale_mode: 0,
      upscale_by: 2,
      upscale_to_width: 1024,
      upscale_to_height: 1024,
      upscale_crop: true,
      upscaler_1_name: "None",
      upscaler_2_name: "None",
      upscaler_2_visibility: 0,
    },
  },
  detailer: {
    enabled: false,
    params: {
      defaults: {},
      models: [],
      sampler: "Default",
      prediction: "default",
      shift: 3,
      cfg_scale: 6,
      options: ["low order"],
      seed: -1,
    },
  },
  grading: {
    enabled: false,
    params: {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      hue: 0,
      gamma: 1,
      sharpness: 0,
      color_temp: 6500,
      shadows: 0,
      midtones: 0,
      highlights: 0,
      clahe_clip: 0,
      clahe_grid: 8,
      shadows_tint: "#000000",
      highlights_tint: "#ffffff",
      split_tone_balance: 0.5,
      vignette: 0,
      grain: 0,
      lut_cube_file: "",
      lut_strength: 1,
    },
  },
  rembg: {
    enabled: false,
    params: {
      model: "ben2",
      merge_alpha: false,
      refine: false,
      mask_only: false,
      postprocess_mask: false,
      alpha_matting: false,
      alpha_matting_foreground_threshold: 240,
      alpha_matting_background_threshold: 10,
      alpha_matting_erode_size: 10,
    },
  },
  nudenet: {
    enabled: false,
    params: {
      enabled: true,
      lang: false,
      policy: false,
      banned: false,
      metadata: true,
      save_copy: false,
      score: 0.2,
      blocks: 3,
      censor: [],
      method: "pixelate",
      overlay: "",
      allowed: "eng",
      alphabet: "latn",
      words: "",
      policy_model: "",
      policy_text: "",
    },
  },
  seedvr: {
    enabled: false,
    params: {
      seedvr_enabled: true,
      seedvr_selected: "SeedVR2 3B",
      seedvr_scale: 2,
      seedvr_seed: -1,
      seedvr_steps: 1,
      seedvr_cfg_scale: 1.5,
      seedvr_cfg_rescale: 0,
      seedvr_tile_size: 1024,
      seedvr_tile_overlap: 0.25,
      seedvr_batch_size: 1,
      seedvr_batch_overlap: 0,
      seedvr_offload: true,
      seedvr_interpolate: 0,
      seedvr_codec: "libx264",
      seedvr_codec_opt: "crf=16",
      seedvr_vae_memory: 0.5,
      seedvr_vae_tile_encode: true,
      seedvr_vae_tile_decode: true,
    },
  },
  pixelart: {
    enabled: false,
    params: {
      pixelart_enabled: true,
      pixelart_block_size: 8,
      pixelart_edge_block_size: 4,
      pixelart_use_edge_detection: true,
      pixelart_image_weight: 1,
      pixelart_sharpen_amount: 0.1,
    },
  },
  dlss: {
    enabled: false,
    params: {
      dlss_enabled: [],
      dlss_graph: false,
      dlss_chunk: 131072,
      dlss_full: false,
      nr_profile: "Standard",
      nr_motion: "Medium",
      nr_scale: 1,
      nr_intensity: 1,
      nr_blend: 0.73974,
      nr_detail: 1,
      nr_colour: 1,
      nr_radius: 4,
      nr_threshold: 0.3,
      nr_normalized: 0,
      nr_local_tone: 1,
      nr_local_structure: 1,
      nr_skin_structure: 0,
      nr_mask_structure: 0,
      ss_profile: "Ultra",
      ss_scale: 2,
      ss_detail: 1,
      ss_colour: 1,
      ss_radius: 4,
      ss_threshold: 0.4,
      fg_profile: "None",
      fg_mode: "fps",
      fg_factor: 2,
      fg_threshold: 0.4,
    },
  },
  createVideo: {
    enabled: false,
    params: {
      filename: "",
      video_type: "MP4",
      duration: 2,
      loop: true,
      pad: 1,
      interpolate: 0,
      scale: 1,
      change: 0.3,
    },
  },
};

interface ProcessState {
  mode: ProcessMode;
  /** Image and batch inputs; image mode uses the first. */
  files: File[];
  previewUrls: string[];
  videoFile: File | null;
  videoPreviewUrl: string | null;
  inputDir: string;
  outputDir: string;
  showResults: boolean;
  saveOutput: boolean;
  sections: ProcessSections;
  results: ProcessResultImage[];
  resultVideo: ProcessResultVideo | null;
  resultInfo: string | null;
  selectedResult: number;
  compareMode: boolean;

  setMode: (mode: ProcessMode) => void;
  setFiles: (files: File[]) => void;
  addFiles: (files: File[]) => void;
  removeFile: (index: number) => void;
  /** Replaces the inputs with one image; other views send images here. */
  setImage: (file: File | null) => void;
  setVideoFile: (file: File | null) => void;
  setInputDir: (dir: string) => void;
  setOutputDir: (dir: string) => void;
  setShowResults: (v: boolean) => void;
  setSaveOutput: (v: boolean) => void;
  setSectionEnabled: (key: ProcessSectionKey, enabled: boolean) => void;
  setSectionParam: <K extends ProcessSectionKey, F extends keyof ProcessSectionParams[K]>(
    key: K,
    field: F,
    value: ProcessSectionParams[K][F],
  ) => void;
  setResults: (
    images: ProcessResultImage[],
    video: ProcessResultVideo | null,
    info: string | null,
  ) => void;
  clearResults: () => void;
  setSelectedResult: (index: number) => void;
  setCompareMode: (enabled: boolean) => void;
}

type PersistedProcess = Pick<
  ProcessState,
  "mode" | "inputDir" | "outputDir" | "showResults" | "saveOutput" | "sections"
>;

function mergeSection<K extends ProcessSectionKey>(
  key: K,
  saved: ProcessSections[K] | undefined,
): ProcessSections[K] {
  if (!saved) return DEFAULT_SECTIONS[key];
  return {
    enabled: saved.enabled,
    params: { ...DEFAULT_SECTIONS[key].params, ...saved.params },
  } as ProcessSections[K];
}

function revokeAll(urls: string[]) {
  for (const url of urls) URL.revokeObjectURL(url);
}

const NO_RESULTS = {
  results: [] as ProcessResultImage[],
  resultVideo: null,
  resultInfo: null,
  selectedResult: 0,
  compareMode: false,
};

export const useProcessStore = create<ProcessState>()(
  persist(
    (set, get) => ({
      mode: "image",
      files: [],
      previewUrls: [],
      videoFile: null,
      videoPreviewUrl: null,
      inputDir: "",
      outputDir: "",
      showResults: true,
      saveOutput: true,
      sections: DEFAULT_SECTIONS,
      ...NO_RESULTS,

      setMode: (mode) => set({ mode, ...NO_RESULTS }),

      setFiles: (files) => {
        revokeAll(get().previewUrls);
        set({
          files,
          previewUrls: files.map((f) => URL.createObjectURL(f)),
          ...NO_RESULTS,
        });
      },

      addFiles: (files) => {
        if (files.length === 0) return;
        const { files: current, previewUrls } = get();
        set({
          files: [...current, ...files],
          previewUrls: [...previewUrls, ...files.map((f) => URL.createObjectURL(f))],
          ...NO_RESULTS,
        });
      },

      removeFile: (index) => {
        const { files, previewUrls } = get();
        const url = previewUrls[index];
        if (url) URL.revokeObjectURL(url);
        set({
          files: files.filter((_, i) => i !== index),
          previewUrls: previewUrls.filter((_, i) => i !== index),
          ...NO_RESULTS,
        });
      },

      setImage: (file) => {
        const { mode } = get();
        get().setFiles(file ? [file] : []);
        if (file && mode !== "image" && mode !== "batch") set({ mode: "image" });
      },

      setVideoFile: (file) => {
        const prev = get().videoPreviewUrl;
        if (prev) URL.revokeObjectURL(prev);
        set({
          videoFile: file,
          videoPreviewUrl: file ? URL.createObjectURL(file) : null,
          ...NO_RESULTS,
        });
      },

      setInputDir: (inputDir) => set({ inputDir }),
      setOutputDir: (outputDir) => set({ outputDir }),
      setShowResults: (showResults) => set({ showResults }),
      setSaveOutput: (saveOutput) => set({ saveOutput }),

      setSectionEnabled: (key, enabled) =>
        set((s) => ({ sections: { ...s.sections, [key]: { ...s.sections[key], enabled } } })),

      setSectionParam: (key, field, value) =>
        set((s) => ({
          sections: {
            ...s.sections,
            [key]: { ...s.sections[key], params: { ...s.sections[key].params, [field]: value } },
          },
        })),

      setResults: (results, resultVideo, resultInfo) =>
        set({ results, resultVideo, resultInfo, selectedResult: 0, compareMode: false }),
      clearResults: () => set({ ...NO_RESULTS }),
      setSelectedResult: (selectedResult) => set({ selectedResult, compareMode: false }),
      setCompareMode: (compareMode) => set({ compareMode }),
    }),
    {
      name: "enso-process",
      version: 2,
      partialize: ({
        mode,
        inputDir,
        outputDir,
        showResults,
        saveOutput,
        sections,
      }): PersistedProcess => ({
        mode,
        inputDir,
        outputDir,
        showResults,
        saveOutput,
        sections,
      }),
      // v1 persisted flat upscale fields; the section shape replaces them
      migrate: (persisted, version) => (version < 2 ? {} : persisted) as PersistedProcess,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<PersistedProcess>;
        const keys = Object.keys(DEFAULT_SECTIONS) as ProcessSectionKey[];
        const sections = Object.fromEntries(
          keys.map((key) => [key, mergeSection(key, saved.sections?.[key])]),
        ) as ProcessSections;
        return { ...current, ...saved, sections };
      },
    },
  ),
);
