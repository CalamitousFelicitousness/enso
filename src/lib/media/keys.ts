// What derived bytes are a function of, as a string, so the hash the server
// answered for them can be remembered for the page's life and a repeated
// action sends a claim instead of a flatten and an upload.

import { canonicalJson } from "@/lib/inputs/freshness";
import type { ProviderEncoding } from "@/lib/inputs/stored";
import type { PlacedPicture, Size } from "@/lib/inputs/types";

/** A composite's bytes: each layer's cid, natural size, opacity, visibility
 * and raw transform in order (the flatten rounds raw transforms, so the
 * quantised map spec is too coarse), the frame size, the size it is drawn at
 * and the provider encoding. */
export function compositeKey(
  layers: readonly PlacedPicture[],
  frame: Size,
  drawnAt: Size,
  encode: ProviderEncoding | null,
): string {
  return `composite|${canonicalJson({
    frame: [frame.width, frame.height],
    drawnAt: [drawnAt.width, drawnAt.height],
    encode,
    layers: layers.map((layer) => [
      layer.cid,
      layer.width,
      layer.height,
      layer.opacity,
      layer.visible,
      layer.transform.x,
      layer.transform.y,
      layer.transform.scaleX,
      layer.transform.scaleY,
      layer.transform.rotation,
    ]),
  })}`;
}

/** A map's bytes as sent: resized to a size or encoded for a provider. */
export function mapSendKey(
  key: string,
  drawnAt: Size | null,
  encode: ProviderEncoding | null,
): string {
  return `map|${canonicalJson({ key, drawnAt: drawnAt && [drawnAt.width, drawnAt.height], encode })}`;
}
