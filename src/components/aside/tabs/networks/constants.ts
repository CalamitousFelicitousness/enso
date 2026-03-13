import type { TypeFilter } from "./types";

export const PAGE_MAP: Record<TypeFilter, string | null> = {
  Model: "model",
  LoRA: "lora",
  Style: null,
  Wildcards: "wildcards",
  Embedding: "embedding",
  VAE: "vae",
};

export const TAG_CATEGORIES = [
  "Distilled",
  "Quantized",
  "Nunchaku",
  "Community",
  "Cloud",
] as const;

export const EXCLUDED_VERSIONS = new Set([
  "ref",
  "reference",
  "ready",
  "download",
]);
