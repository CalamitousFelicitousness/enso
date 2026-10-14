// Object URLs and decoded images for input pictures, by Blob. The only place
// that creates or revokes either: components ask for what they draw and let
// go on unmount.

import { useEffect, useState } from "react";
import type { PixelSize } from "@/lib/media/dimensions";
import { DISPLAY_PIXELS } from "@/lib/media/limits";
import { useEffectiveLimit } from "./admit";

interface Entry {
  url: string;
  users: number;
  image: Promise<HTMLImageElement> | null;
  /** The image once it has decoded. */
  decoded: HTMLImageElement | null;
  /** A picture above the display budget, decoded at the budget. */
  bitmap: Promise<ImageBitmap> | null;
  release: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<Blob, Entry>();

/** A blob nobody draws keeps its URL this long, so a remount (StrictMode, a
 * tab switch) finds it decoded. */
const RELEASE_MS = 1000;

function acquire(blob: Blob): Entry {
  let entry = entries.get(blob);
  if (!entry) {
    entry = {
      url: URL.createObjectURL(blob),
      users: 0,
      image: null,
      decoded: null,
      bitmap: null,
      release: null,
    };
    entries.set(blob, entry);
  }
  if (entry.release) {
    clearTimeout(entry.release);
    entry.release = null;
  }
  entry.users += 1;
  return entry;
}

function release(blob: Blob): void {
  const entry = entries.get(blob);
  if (!entry) return;
  entry.users -= 1;
  if (entry.users > 0) return;
  entry.release = setTimeout(() => {
    URL.revokeObjectURL(entry.url);
    void entry.bitmap?.then(
      (bitmap) => bitmap.close(),
      () => {},
    );
    entries.delete(blob);
  }, RELEASE_MS);
}

function decode(entry: Entry): Promise<HTMLImageElement> {
  entry.image ??= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      entry.decoded = image;
      resolve(image);
    };
    image.onerror = () => reject(new Error("picture could not be decoded"));
    image.src = entry.url;
  });
  return entry.image;
}

function displayBitmap(blob: Blob, entry: Entry, size: PixelSize): Promise<ImageBitmap> {
  const scale = Math.sqrt(DISPLAY_PIXELS / (size.width * size.height));
  entry.bitmap ??= createImageBitmap(blob, {
    resizeWidth: Math.max(1, Math.round(size.width * scale)),
    resizeHeight: Math.max(1, Math.round(size.height * scale)),
    resizeQuality: "high",
  });
  return entry.bitmap;
}

type Shown = HTMLImageElement | ImageBitmap;

function show(blob: Blob, entry: Entry, size: PixelSize | null): Promise<Shown> {
  return size && size.width * size.height > DISPLAY_PIXELS
    ? displayBitmap(blob, entry, size)
    : decode(entry);
}

function useShown(blob: Blob | null, size: PixelSize | null): Shown | null {
  const [loaded, setLoaded] = useState<{ blob: Blob; image: Shown } | null>(null);
  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  useEffect(() => {
    if (!blob) return;
    let current = true;
    const known = width > 0 && height > 0 ? { width, height } : null;
    show(blob, acquire(blob), known).then(
      (image) => {
        if (current) setLoaded({ blob, image });
      },
      () => {},
    );
    return () => {
      current = false;
      release(blob);
    };
  }, [blob, width, height]);
  return loaded?.blob === blob ? loaded.image : null;
}

/** The blob as something Konva draws: the decoded image, or for a picture
 * above the display budget a bitmap decoded at it. Null until decoded, for a
 * blob that does not decode, and for a picture over the input limit, which is
 * never decoded. */
export function useBlobImage(blob: Blob | null, size: PixelSize | null = null): Shown | null {
  const limit = useEffectiveLimit();
  const tooLarge = size !== null && size.width * size.height > limit.pixels;
  return useShown(tooLarge ? null : blob, size);
}

/** A URL for a small blob once it has decoded, for an <img>. */
export function useBlobUrl(blob: Blob | null): string | null {
  const image = useShown(blob, null);
  return image instanceof HTMLImageElement ? image.src : null;
}

/** The blob as an image something here has already decoded, else null. */
export function decodedImage(blob: Blob): HTMLImageElement | null {
  return entries.get(blob)?.decoded ?? null;
}

/** Natural size of an image file. Rejects when it does not decode. */
export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const entry = acquire(blob);
  try {
    const image = await decode(entry);
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    release(blob);
  }
}
