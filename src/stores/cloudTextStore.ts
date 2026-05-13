import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CloudTextSlot {
  provider: string;
  model: string;
}

interface CloudTextState {
  // Last-used cloud model per text feature. Persisted across sessions so the
  // user doesn't re-pick every time.
  enhance: CloudTextSlot;
  caption: CloudTextSlot;
  vqa: CloudTextSlot;
  // Per-feature options the user may want to tweak per-feature.
  enhanceSystemPrompt: string;
  enhanceNsfw: boolean;
  captionPrompt: string;
  vqaQuestion: string;

  setSlot: (key: "enhance" | "caption" | "vqa", slot: CloudTextSlot) => void;
  setEnhanceSystemPrompt: (s: string) => void;
  setEnhanceNsfw: (b: boolean) => void;
  setCaptionPrompt: (s: string) => void;
  setVqaQuestion: (s: string) => void;
}

const EMPTY: CloudTextSlot = { provider: "", model: "" };

export const useCloudTextStore = create<CloudTextState>()(
  persist(
    (set) => ({
      enhance: EMPTY,
      caption: EMPTY,
      vqa: EMPTY,
      enhanceSystemPrompt: "",
      enhanceNsfw: true,
      captionPrompt: "Describe this image in detail.",
      vqaQuestion: "",

      setSlot: (key, slot) => set({ [key]: slot }),
      setEnhanceSystemPrompt: (s) => set({ enhanceSystemPrompt: s }),
      setEnhanceNsfw: (b) => set({ enhanceNsfw: b }),
      setCaptionPrompt: (s) => set({ captionPrompt: s }),
      setVqaQuestion: (s) => set({ vqaQuestion: s }),
    }),
    { name: "enso-cloud-text" },
  ),
);
