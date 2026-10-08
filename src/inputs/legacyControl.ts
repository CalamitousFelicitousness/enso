// Control units as older builds stored them, with their base64 pictures
// decoded, on their way to becoming frames.

import { imageSize } from "./media";
import { base64ToBlob } from "@/lib/utils";
import type { LegacyBytes, LegacyControlUnit, RawControlUnit } from "@/lib/inputs/legacyControl";

/** The picture's bytes with its size, or null for base64 that is not an image. */
export async function legacyBytes(base64: string | null): Promise<LegacyBytes | null> {
  if (!base64) return null;
  try {
    const blob = base64ToBlob(base64);
    return { blob, ...(await imageSize(blob)) };
  } catch {
    return null;
  }
}

async function decodeUnit(unit: RawControlUnit): Promise<LegacyControlUnit> {
  const [image, processedImage, images, masks] = await Promise.all([
    legacyBytes(unit.image),
    legacyBytes(unit.processedImage),
    Promise.all(unit.images.map(legacyBytes)),
    Promise.all(unit.masks.map(legacyBytes)),
  ]);
  return {
    ...unit,
    image,
    processedImage,
    images: images.filter(Boolean),
    masks: masks.filter(Boolean),
  };
}

export function decodeLegacyUnits(units: RawControlUnit[]): Promise<LegacyControlUnit[]> {
  return Promise.all(units.map(decodeUnit));
}
