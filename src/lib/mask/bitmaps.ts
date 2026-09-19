// Drawable copies of mask layers, keyed by the layer's PNG blob. The blob
// identity is stable across layer spreads and changes exactly when the
// pixels do, so nothing needs invalidating.

const bitmaps = new WeakMap<Blob, ImageBitmap>();
const decoding = new WeakMap<Blob, Promise<ImageBitmap>>();

export function maskBitmap(layer: { blob: Blob }): ImageBitmap | undefined {
  return bitmaps.get(layer.blob);
}

export function rememberMaskBitmap(blob: Blob, bitmap: ImageBitmap): void {
  bitmaps.set(blob, bitmap);
}

/** The bitmap for a blob, decoding it once when no bake produced one in this
 * session (masks restored from IndexedDB). */
export function ensureMaskBitmap(blob: Blob): Promise<ImageBitmap> {
  const hit = bitmaps.get(blob);
  if (hit) return Promise.resolve(hit);
  let pending = decoding.get(blob);
  if (!pending) {
    pending = createImageBitmap(blob).then((bitmap) => {
      bitmaps.set(blob, bitmap);
      decoding.delete(blob);
      return bitmap;
    });
    decoding.set(blob, pending);
  }
  return pending;
}
