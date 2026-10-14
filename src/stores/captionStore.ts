import { create } from "zustand";
import type {
  CaptionMethod,
  CloudCaptionResult,
  OpenClipResponse,
  TaggerResponse,
  VqaResponse,
} from "@/api/types/caption";
import { admit, announceRefusals } from "@/inputs/admit";

export type CaptionResult =
  | (OpenClipResponse & { type: "openclip" })
  | (TaggerResponse & { type: "tagger" })
  | (VqaResponse & { type: "vqa" })
  | (CloudCaptionResult & { type: "cloud" })
  | null;

interface CaptionState {
  image: File | null;
  imagePreviewUrl: string | null;
  result: CaptionResult;
  isProcessing: boolean;
  method: CaptionMethod;
  // Cloud method has two sub-modes: describe (caption) and ask (vqa).
  cloudMode: "caption" | "vqa";

  /** Answers whether the image was taken; a refused one leaves the image here. */
  setImage: (file: File | null) => Promise<boolean>;
  setResult: (result: CaptionResult) => void;
  setProcessing: (v: boolean) => void;
  setMethod: (m: CaptionMethod) => void;
  setCloudMode: (m: "caption" | "vqa") => void;
  reset: () => void;
}

export const useCaptionStore = create<CaptionState>()((set, get) => ({
  image: null,
  imagePreviewUrl: null,
  result: null,
  isProcessing: false,
  method: "vlm",
  cloudMode: "caption",

  setImage: async (file) => {
    if (file) {
      const admission = await admit(file, "caption");
      if (!admission.ok) {
        announceRefusals([{ name: file.name, refusal: admission.refusal }]);
        return false;
      }
    }
    const prev = get().imagePreviewUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      image: file,
      imagePreviewUrl: file ? URL.createObjectURL(file) : null,
      result: null,
    });
    return true;
  },

  setResult: (result) => set({ result }),
  setProcessing: (v) => set({ isProcessing: v }),
  setMethod: (m) => set({ method: m }),
  setCloudMode: (m) => set({ cloudMode: m }),

  reset: () => {
    const prev = get().imagePreviewUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      image: null,
      imagePreviewUrl: null,
      result: null,
      isProcessing: false,
      method: "vlm",
      cloudMode: "caption",
    });
  },
}));
