import { Facet } from "@codemirror/state";
import type { ExtraNetworkV2, PromptStyleV2 } from "@/api/types/models";

// Shared regex for all prompt token types
// Groups: 1,2 = <type:args> | 3 = __wildcard__ | 4,5 = (content:weight)
export const TOKEN_PATTERN =
  /<(\w+):([^>]+)>|__(\w[\w\s/.+-]*)__|\(([^()]+):(\d+\.?\d*)\)/;

// ── Dynamic data facets (reconfigured from React via Compartments) ───

export const embeddingNamesFacet = Facet.define<string[], string[]>({
  combine: (values) => values[0] ?? [],
});

export const loraNamesFacet = Facet.define<ExtraNetworkV2[], ExtraNetworkV2[]>({
  combine: (values) => values[0] ?? [],
});

export const styleNamesFacet = Facet.define<PromptStyleV2[], PromptStyleV2[]>({
  combine: (values) => values[0] ?? [],
});

export const wildcardNamesFacet = Facet.define<
  ExtraNetworkV2[],
  ExtraNetworkV2[]
>({
  combine: (values) => values[0] ?? [],
});
