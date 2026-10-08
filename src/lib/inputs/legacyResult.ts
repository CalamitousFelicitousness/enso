// The inputs an older build kept beside a result, as frames: the frame as it
// was sent, flattened, with its mask strokes, and the control units with
// their pictures. The caller decodes and measures the pictures.

import type { WireParams } from "@/api/types/wireParams";
import { fitTransform } from "./geometry";
import { REFERENCE_HEIGHT } from "./layout";
import { controlToFrames, type LegacyBytes, type LegacyControlUnit } from "./legacyControl";
import { newFrame, newPicture } from "./reducers";
import type { Frame, MaskStroke, Picture, Size } from "./types";

export interface LegacyResultInputs {
  /** The frame as it was sent, flattened. */
  image: LegacyBytes | null;
  strokes: MaskStroke[];
  units: LegacyControlUnit[];
  /** The frame size the result was made at. */
  size: Size;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);

/** The frame size a result was made at: the generation size it sent, else
 * the size of an older request shape. */
export function legacyResultSize(p: WireParams): Size {
  return {
    width: num(p.width_before ?? p.width, 1024),
    height: num(p.height_before ?? p.height, 1024),
  };
}

/** One Initial frame holding the flattened picture at its own size, fitted
 * inside the frame, with the strokes; then the control units, linked to it
 * where they took the canvas. No frames when the result kept nothing. */
export function legacyResultToFrames(
  input: LegacyResultInputs,
  newId: () => string,
  newCid: () => string,
): Frame[] {
  const frames: Frame[] = [];
  let initialFrameId: string | null = null;
  if (input.image || input.strokes.length > 0) {
    initialFrameId = newId();
    const pictures: Picture[] = input.image
      ? [
          {
            ...newPicture({
              id: newId(),
              cid: newCid(),
              file: input.image.blob,
              name: "Restored input",
              width: input.image.width,
              height: input.image.height,
            }),
            transform: fitTransform(input.image, input.size, "contain"),
          },
        ]
      : [];
    frames.push({
      ...newFrame(initialFrameId, "initial"),
      pictures,
      mask: { objects: [], strokes: input.strokes },
    });
  }
  if (input.units.length > 0) {
    const context = { size: input.size, displayHeight: REFERENCE_HEIGHT, initialFrameId };
    frames.push(...controlToFrames(input.units, context, newId, newCid).frames);
  }
  return frames;
}
