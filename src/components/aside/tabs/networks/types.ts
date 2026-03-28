import type { ExtraNetworkV2, PromptStyleV2 } from "@/api/types/models";

export const TYPE_FILTERS = [
  "Model",
  "LoRA",
  "Style",
  "Wildcards",
  "Embedding",
  "VAE",
] as const;
export type TypeFilter = (typeof TYPE_FILTERS)[number];

export type SortMode = "name" | "base-model" | "recent";

export interface ActiveLora {
  name: string;
  weight: number;
}

export interface SidebarGroup {
  header?: string;
  items: string[];
}

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  count: number;
}

export type NetworkItem = ExtraNetworkV2 | PromptStyleV2;
