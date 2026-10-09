// The inputs an older build kept beside a result, decoded into frames.

import type { GenerationResult } from "@/stores/generationStore";
import { readLegacyControl } from "@/lib/inputs/legacyControl";
import { legacyResultSize, legacyResultToFrames } from "@/lib/inputs/legacyResult";
import type { Inputs } from "@/lib/inputs/stored";
import { decodeLegacyUnits, legacyBytes } from "./legacyControl";

/** Whether an older build kept anything of the result's inputs beside it. */
export function hasLegacyInputs(result: GenerationResult): boolean {
  return Boolean(
    result.inputsKey ||
    result.inputImage ||
    (result.inputMask && result.inputMask.length > 0) ||
    (result.controlUnits && result.controlUnits.length > 0),
  );
}

/** The flattened picture, strokes and control units an older build kept
 * beside a result, as frames; null when it kept none. */
export async function legacyResultInputs(result: GenerationResult): Promise<Inputs | null> {
  const size = legacyResultSize(result.parameters);
  const image = await legacyBytes(result.inputImage ?? null);
  const units = result.controlUnits?.length
    ? await decodeLegacyUnits(readLegacyControl(result.controlUnits))
    : [];
  const frames = legacyResultToFrames(
    { image, strokes: result.inputMask ?? [], units, size },
    () => crypto.randomUUID(),
    () => crypto.randomUUID(),
  );
  return frames.length > 0 ? { frames, size, sizeSource: null } : null;
}
