import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SizeMode } from "@/lib/sizeCompute";

export type { SizeMode };

// Canonical MaskLine type lives on canvasStore now. Re-exported here for
// the small set of consumers that imported it from this module before
// the per-frame migration; future code should import directly from
// canvasStore.
import type { MaskLine } from "@/stores/canvasStore";
export type { MaskLine };

interface Img2ImgState {
  // Resize mode
  resizeMode: number;

  // Size mode (Fixed / Scale / Megapixel)
  sizeMode: SizeMode;
  scaleFactor: number;
  megapixelTarget: number;
  resizeMethod: string;

  // Auto-size modifier: when true, the cloud adapter receives size="auto" and the
  // server picks output dimensions. Local img2img ignores this flag (resolution
  // is determined by the input image and pipeline anyway).
  autoSize: boolean;

  // Mask params (mask content itself lives per-Input-frame on canvasStore)
  maskBlur: number;
  inpaintFullRes: boolean;
  inpaintFullResPadding: number;
  inpaintingMaskInvert: boolean;
  maskApplyOverlay: boolean;
  inpaintingMaskWeight: number;

  // Actions
  setResizeMode: (mode: number) => void;
  setSizeMode: (mode: SizeMode) => void;
  setScaleFactor: (factor: number) => void;
  setMegapixelTarget: (target: number) => void;
  setResizeMethod: (method: string) => void;
  setAutoSize: (v: boolean) => void;
  setMaskBlur: (blur: number) => void;
  setInpaintFullRes: (v: boolean) => void;
  setInpaintFullResPadding: (v: number) => void;
  setInpaintingMaskInvert: (v: boolean) => void;
  setMaskApplyOverlay: (v: boolean) => void;
  setInpaintingMaskWeight: (v: number) => void;
  reset: () => void;
}

const defaultState = {
  resizeMode: 1,
  sizeMode: "fixed" as SizeMode,
  scaleFactor: 1,
  megapixelTarget: 1,
  resizeMethod: "Resize Lanczos",
  autoSize: false,
  maskBlur: 4,
  inpaintFullRes: false,
  inpaintFullResPadding: 32,
  inpaintingMaskInvert: false,
  maskApplyOverlay: true,
  inpaintingMaskWeight: 1.0,
};

export const useImg2ImgStore = create<Img2ImgState>()(
  persist(
    (_set) => ({
      ...defaultState,

      setResizeMode: (mode) => _set({ resizeMode: mode }),
      setSizeMode: (mode) => _set({ sizeMode: mode }),
      setScaleFactor: (factor) => _set({ scaleFactor: factor }),
      setMegapixelTarget: (target) => _set({ megapixelTarget: target }),
      setResizeMethod: (method) => _set({ resizeMethod: method }),
      setAutoSize: (v) => _set({ autoSize: v }),
      setMaskBlur: (blur) => _set({ maskBlur: blur }),
      setInpaintFullRes: (v) => _set({ inpaintFullRes: v }),
      setInpaintFullResPadding: (v) => _set({ inpaintFullResPadding: v }),
      setInpaintingMaskInvert: (v) => _set({ inpaintingMaskInvert: v }),
      setMaskApplyOverlay: (v) => _set({ maskApplyOverlay: v }),
      setInpaintingMaskWeight: (v) => _set({ inpaintingMaskWeight: v }),

      reset: () => _set(defaultState),
    }),
    {
      name: "enso-img2img",
      version: 2,
      partialize: ({
        resizeMode,
        sizeMode,
        scaleFactor,
        megapixelTarget,
        resizeMethod,
        autoSize,
        maskBlur,
        inpaintFullRes,
        inpaintFullResPadding,
        inpaintingMaskInvert,
        maskApplyOverlay,
        inpaintingMaskWeight,
      }) => ({
        resizeMode,
        sizeMode,
        scaleFactor,
        megapixelTarget,
        resizeMethod,
        autoSize,
        maskBlur,
        inpaintFullRes,
        inpaintFullResPadding,
        inpaintingMaskInvert,
        maskApplyOverlay,
        inpaintingMaskWeight,
      }),
    },
  ),
);
