import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CheckpointGuidanceV2, CheckpointInfoV2, DetailerMode } from "@/api/types/models";

const LIMIT = 64;

/** What a checkpoint's pipeline reported while it was loaded. */
export interface ModelCapabilityRecord {
  class_name: string | null;
  max_input_images: number | null;
  request_sets_size: boolean | null;
  size_multiple: number | null;
  guidance: CheckpointGuidanceV2 | null;
  detailer_mode: DetailerMode | null;
  strength_applicable: boolean | null;
  control_unified: boolean | null;
}

export function capabilityRecord(checkpoint: CheckpointInfoV2): ModelCapabilityRecord {
  return {
    class_name: checkpoint.class_name ?? null,
    max_input_images: checkpoint.max_input_images ?? null,
    request_sets_size: checkpoint.request_sets_size ?? null,
    size_multiple: checkpoint.size_multiple ?? null,
    guidance: checkpoint.guidance ?? null,
    detailer_mode: checkpoint.detailer_mode ?? null,
    strength_applicable: checkpoint.strength_applicable ?? null,
    control_unified: checkpoint.control_unified ?? null,
  };
}

interface ModelCapabilityState {
  /** Per model title, from the last time it was seen loaded. The server only
   * reports these for the loaded model, so this is what a selected model that
   * is not loaded yet is assumed to do. */
  byTitle: Record<string, ModelCapabilityRecord>;
  remember: (checkpoint: CheckpointInfoV2) => void;
}

export const useModelCapabilityStore = create<ModelCapabilityState>()(
  persist(
    (set, get) => ({
      byTitle: {},

      remember: (checkpoint) => {
        if (!checkpoint.loaded || !checkpoint.title) return;
        const record = capabilityRecord(checkpoint);
        const { [checkpoint.title]: known, ...others } = get().byTitle;
        if (JSON.stringify(known) === JSON.stringify(record)) return;
        // Insertion order is age: the oldest titles fall off past the limit
        const titles = Object.keys(others).slice(-(LIMIT - 1));
        const kept = Object.fromEntries(titles.map((title) => [title, others[title]]));
        set({ byTitle: { ...kept, [checkpoint.title]: record } });
      },
    }),
    { name: "enso-model-capabilities", version: 1 },
  ),
);
