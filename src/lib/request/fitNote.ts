// The note under Size when the size the frame took from a picture is far
// above what the model usually makes, with a way back that moves nothing.

import type { PixelSize } from "@/lib/media/dimensions";
import type { Declaration } from "@/lib/media/rules";
import { megapixelsText, sizeText } from "@/lib/media/text";
import { getModelDefaults } from "@/lib/modelDefaults";
import type { SizeMode } from "@/lib/sizeCompute";

/** The note shows above this many times the model's usual area. */
export const FIT_NOTE_FACTOR = 4;

export interface FitNoteInput {
  /** The effective size mode. */
  mode: SizeMode;
  /** What gave the size: Fit from a picture, or a lone Reference the model
   * generates at; null for neither. `source` names the picture. */
  setBy: { by: "fit" | "reference"; source: string } | null;
  size: PixelSize;
  /** The model's usual output size, null when unknown. */
  native: PixelSize | null;
}

export interface FitNote {
  text: string;
  /** Megapixel at the usual area (`target` in MP), or the Reference's switch to Initial. */
  action: { kind: "megapixel"; target: number; label: string } | { kind: "toInitial" };
}

const COST = "Larger sizes take longer, use more memory and can repeat the subject.";

export function fitNote({ mode, setBy, size, native }: FitNoteInput): FitNote | null {
  if (mode !== "fixed" || !setBy || !native) return null;
  const area = size.width * size.height;
  const nativeArea = native.width * native.height;
  if (area <= FIT_NOTE_FACTOR * nativeArea) return null;
  const times = Math.round(area / nativeArea);
  const at = `${sizeText(size)} (${megapixelsText(area)})`;
  if (setBy.by === "reference") {
    return {
      text: `This model generates at ${setBy.source}'s size, ${at}, ${times} times its usual ${sizeText(native)}. ${COST}`,
      action: { kind: "toInitial" },
    };
  }
  return {
    text: `Fit set the size to ${at} from ${setBy.source}, ${times} times this model's usual ${sizeText(native)}. ${COST}`,
    action: {
      kind: "megapixel",
      target: nativeArea / 1_000_000,
      label: `Use Megapixel at ${megapixelsText(nativeArea)}`,
    },
  };
}

/** The size a model usually makes: the output area its reference declaration
 * documents, as a square, else its family's default size; null for neither. */
export function usualSize(reference: Declaration, type: string | null): PixelSize | null {
  const area = reference.kind === "declared" ? reference.declared.outputArea : undefined;
  if (area) {
    const side = Math.round(Math.sqrt(area));
    return { width: side, height: side };
  }
  const defaults = getModelDefaults(type);
  return defaults?.width && defaults.height
    ? { width: defaults.width, height: defaults.height }
    : null;
}
