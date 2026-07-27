import type { TypeFilter } from "./types";

export const PAGE_MAP: Record<TypeFilter, string | null> = {
  Model: "model",
  LoRA: "lora",
  Style: null,
  Wildcards: "wildcards",
  Embedding: "embedding",
  UNET: "unet/dit",
  VAE: "vae",
};

// Styles are browsed via /prompt-styles rather than the extra-networks
// listing, so PAGE_MAP nulls them out. The refresh endpoint still has a
// real "style" page, hence the separate map.
export const REFRESH_PAGE_MAP: Record<TypeFilter, string> = {
  Model: "model",
  LoRA: "lora",
  Style: "style",
  Wildcards: "wildcards",
  Embedding: "embedding",
  UNET: "unet/dit",
  VAE: "vae",
};

// Display text only. The TypeFilter values stay long-form because they key
// PAGE_MAP, REFRESH_PAGE_MAP and the scan guard; these are abbreviated so all
// seven segments fit the filter row at the default panel width.
export const TYPE_FILTER_LABELS: Record<TypeFilter, string> = {
  Model: "Model",
  LoRA: "LoRA",
  Style: "Style",
  Wildcards: "Wild",
  Embedding: "Embed",
  UNET: "UNET",
  VAE: "VAE",
};

export const TAG_CATEGORIES = ["Distilled", "Quantized", "Nunchaku", "Community", "Cloud"] as const;

export const EXCLUDED_VERSIONS = new Set(["ref", "reference", "ready", "download"]);
