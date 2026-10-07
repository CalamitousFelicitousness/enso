import type { PreprocessorInfo } from "@/api/types/control";
import type { ComboboxGroup } from "@/components/ui/combobox";
import { processToLabel } from "@/lib/inputs/text";
import type { JsonValue } from "@/lib/inputs/types";

const GROUP_ORDER = ["Pose", "Edge", "Depth", "Normal", "Segmentation", "Other"] as const;

/** The processors by group, each labelled by what it makes and its name. */
export function buildProcessorGroups(preprocessors: PreprocessorInfo[]): ComboboxGroup[] {
  const buckets: Record<string, string[]> = {};
  for (const p of preprocessors) {
    if (p.name === "None") continue;
    const group = p.group || "Other";
    (buckets[group] ??= []).push(p.name);
  }
  for (const names of Object.values(buckets)) {
    names.sort((a, b) => a.localeCompare(b));
  }
  return GROUP_ORDER.filter((g) => buckets[g]?.length).map((g) => ({
    heading: g,
    options: buckets[g].map((name) => ({ value: name, label: processToLabel(g, name) })),
  }));
}

/** What a map key needs of the server's processors: the runner's revision and
 * each processor's default parameters. */
export interface ProcessorFacts {
  revision: string;
  defaults: Record<string, Record<string, JsonValue>>;
}

export function processorFacts(list: PreprocessorInfo[]): ProcessorFacts {
  return {
    revision: list[0]?.revision ?? "",
    defaults: Object.fromEntries(list.map((p) => [p.name, p.params as Record<string, JsonValue>])),
  };
}
