import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ResultSource = "upscale" | "rembg" | null;

interface ProcessState {
  image: File | null;
  imagePreviewUrl: string | null;
  upscaler: string;
  scale: number;
  resizeMode: number; // 0 = scale factor, 1 = explicit dimensions
  targetWidth: number;
  targetHeight: number;
  crop: boolean;
  upscaler2: string;
  upscaler2Visibility: number;
  rembgModel: string;
  returnMask: boolean;
  refine: boolean;
  resultImageUrl: string | null;
  resultWidth: number | null;
  resultHeight: number | null;
  resultSource: ResultSource;
  compareMode: boolean;

  setImage: (file: File | null) => void;
  setUpscaler: (upscaler: string) => void;
  setScale: (scale: number) => void;
  setResizeMode: (mode: number) => void;
  setTargetWidth: (w: number) => void;
  setTargetHeight: (h: number) => void;
  setCrop: (enabled: boolean) => void;
  setUpscaler2: (upscaler: string) => void;
  setUpscaler2Visibility: (v: number) => void;
  setRembgModel: (model: string) => void;
  setReturnMask: (enabled: boolean) => void;
  setRefine: (enabled: boolean) => void;
  setResult: (url: string | null, width?: number, height?: number, source?: ResultSource) => void;
  setCompareMode: (enabled: boolean) => void;
  reset: () => void;
}

export const useProcessStore = create<ProcessState>()(
  persist(
    (set, get) => ({
      image: null,
      imagePreviewUrl: null,
      upscaler: "None",
      scale: 2,
      resizeMode: 0,
      targetWidth: 0,
      targetHeight: 0,
      crop: true,
      upscaler2: "None",
      upscaler2Visibility: 0,
      rembgModel: "ben2",
      returnMask: false,
      refine: false,
      resultImageUrl: null,
      resultWidth: null,
      resultHeight: null,
      resultSource: null,
      compareMode: false,

      setImage: (file) => {
        const prev = get().imagePreviewUrl;
        if (prev) URL.revokeObjectURL(prev);
        set({
          image: file,
          imagePreviewUrl: file ? URL.createObjectURL(file) : null,
          resultImageUrl: null,
          resultWidth: null,
          resultHeight: null,
          resultSource: null,
          compareMode: false,
        });
      },

      setUpscaler: (upscaler) => set({ upscaler }),
      setScale: (scale) => set({ scale }),
      setResizeMode: (mode) => set({ resizeMode: mode }),
      setTargetWidth: (w) => set({ targetWidth: w }),
      setTargetHeight: (h) => set({ targetHeight: h }),
      setCrop: (enabled) => set({ crop: enabled }),
      setUpscaler2: (upscaler) => set({ upscaler2: upscaler }),
      setUpscaler2Visibility: (v) => set({ upscaler2Visibility: v }),
      setRembgModel: (model) => set({ rembgModel: model }),
      setReturnMask: (enabled) => set({ returnMask: enabled }),
      setRefine: (enabled) => set({ refine: enabled }),
      setCompareMode: (enabled) => set({ compareMode: enabled }),
      setResult: (url, width, height, source) => set({
        resultImageUrl: url,
        resultWidth: width ?? null,
        resultHeight: height ?? null,
        resultSource: source ?? null,
      }),

      reset: () => {
        const prev = get().imagePreviewUrl;
        if (prev) URL.revokeObjectURL(prev);
        set({
          image: null,
          imagePreviewUrl: null,
          upscaler: "None",
          scale: 2,
          resizeMode: 0,
          targetWidth: 0,
          targetHeight: 0,
          crop: true,
          upscaler2: "None",
          upscaler2Visibility: 0,
          rembgModel: "ben2",
          returnMask: false,
          refine: false,
          resultImageUrl: null,
          resultWidth: null,
          resultHeight: null,
          resultSource: null,
        });
      },
    }),
    {
      name: "enso-process",
      partialize: ({ upscaler, scale, resizeMode, targetWidth, targetHeight, crop, upscaler2, upscaler2Visibility, rembgModel, returnMask, refine }) => ({
        upscaler, scale, resizeMode, targetWidth, targetHeight, crop, upscaler2, upscaler2Visibility, rembgModel, returnMask, refine,
      }),
    },
  ),
);
