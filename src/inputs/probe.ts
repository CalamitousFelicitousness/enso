// What this browser decodes, and which kinds it shows without applying their
// orientation tag, answered once per page by decoding the small samples.

import type { ImageKind, PixelSize } from "@/lib/media/dimensions";
import { ORIENTED_SAMPLES, SAMPLE_TYPES, SAMPLES } from "@/lib/media/samples";

export interface BrowserMedia {
  kinds: ReadonlySet<ImageKind>;
  ignoresOrientation: ReadonlySet<ImageKind>;
}

const bytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

async function decodedSize(base64: string, type: string): Promise<PixelSize | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes(base64)], { type }));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

let probed: Promise<BrowserMedia> | null = null;

export function browserMedia(): Promise<BrowserMedia> {
  probed ??= (async () => {
    const samples = Object.entries(SAMPLES) as [ImageKind, string][];
    const decoded = await Promise.all(
      samples.map(([kind, data]) => decodedSize(data, SAMPLE_TYPES[kind])),
    );
    const oriented = Object.entries(ORIENTED_SAMPLES) as [ImageKind, string][];
    // A 2x1 sample tagged 6 shows as 1x2 where the decode applies the tag
    const shown = await Promise.all(
      oriented.map(([kind, data]) => decodedSize(data, SAMPLE_TYPES[kind])),
    );
    return {
      kinds: new Set(samples.filter((_, i) => decoded[i] !== null).map(([kind]) => kind)),
      ignoresOrientation: new Set(
        oriented.filter((_, i) => shown[i]?.width === 2).map(([kind]) => kind),
      ),
    };
  })();
  return probed;
}
