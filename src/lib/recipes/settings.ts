// A recipe's settings snapshot: the generation store's values for the keys
// its defaults know, which is what Restore puts back.

import type { GenerationState } from "@/stores/generationStore";
import type { ExtractedSettings } from "@/lib/request/restoreParams";
import type { JsonValue } from "@/lib/inputs/types";
import portable from "./portable.json";

const DROPPED = new Set(portable.settingsDrop);

function snapshot(
  values: Readonly<Record<string, unknown>>,
  keys: Iterable<string>,
): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const key of keys) {
    if (DROPPED.has(key) || values[key] === undefined) continue;
    out[key] = JSON.parse(JSON.stringify(values[key])) as JsonValue;
  }
  return out;
}

/** The settings as they stand, for a recipe saved from the canvas. */
export function snapshotSettings(
  gen: Readonly<Partial<GenerationState>>,
  defaults: Readonly<Record<string, unknown>>,
): Record<string, JsonValue> {
  return snapshot(gen, Object.keys(defaults));
}

/** The settings a job ran with, for a recipe saved from its result. */
export function settingsOf(
  extracted: Pick<ExtractedSettings, "params">,
): Record<string, JsonValue> {
  return snapshot(extracted.params, Object.keys(extracted.params));
}
