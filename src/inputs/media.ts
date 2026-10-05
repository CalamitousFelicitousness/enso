// Object URLs and decoded images for input pictures, by Blob. The only place
// that creates or revokes either: components ask for what they draw and let
// go on unmount.

import { useEffect, useState } from "react";

interface Entry {
  url: string;
  users: number;
  image: Promise<HTMLImageElement> | null;
  release: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<Blob, Entry>();

/** A blob nobody draws keeps its URL this long, so a remount (StrictMode, a
 * tab switch) finds it decoded. */
const RELEASE_MS = 1000;

function acquire(blob: Blob): Entry {
  let entry = entries.get(blob);
  if (!entry) {
    entry = { url: URL.createObjectURL(blob), users: 0, image: null, release: null };
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
    entries.delete(blob);
  }, RELEASE_MS);
}

function decode(entry: Entry): Promise<HTMLImageElement> {
  entry.image ??= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("picture could not be decoded"));
    image.src = entry.url;
  });
  return entry.image;
}

/** The blob as a decoded image element, for Konva. Null until decoded, and
 * for a blob that does not decode. */
export function useBlobImage(blob: Blob | null): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ blob: Blob; image: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!blob) return;
    let current = true;
    decode(acquire(blob)).then(
      (image) => {
        if (current) setLoaded({ blob, image });
      },
      () => {},
    );
    return () => {
      current = false;
      release(blob);
    };
  }, [blob]);
  return loaded?.blob === blob ? loaded.image : null;
}

/** A URL for the blob once it has decoded, for an <img>. */
export function useBlobUrl(blob: Blob | null): string | null {
  return useBlobImage(blob)?.src ?? null;
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
