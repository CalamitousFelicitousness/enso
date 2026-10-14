// What derived bytes are a function of, as a string, so the hash the server
// answered for them can be remembered for the page's life and a repeated
// action sends a claim instead of a flatten and an upload.

import { canonicalJson } from "@/lib/inputs/freshness";
import type { ProviderEncoding } from "@/lib/inputs/stored";
import type { PlacedPicture, Size } from "@/lib/inputs/types";
import type { Fit } from "./sizeRule";

/** A composite's bytes: each layer's cid, natural size, opacity, visibility
 * and raw transform in order (the flatten rounds raw transforms, so the
 * quantised map spec is too coarse), the frame size, the size it is drawn at,
 * the provider encoding and the fit it is cropped to after. */
export function compositeKey(
  layers: readonly PlacedPicture[],
  frame: Size,
  drawnAt: Size,
  encode: ProviderEncoding | null,
  fit: Fit | null = null,
): string {
  return `composite|${canonicalJson({
    frame: [frame.width, frame.height],
    drawnAt: [drawnAt.width, drawnAt.height],
    encode,
    ...(fit ? { fit: [fit.mode, fit.width, fit.height] } : {}),
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

const encodingOf = (encode: ProviderEncoding | null) =>
  encode ? `${encode.provider}:${encode.model}` : "png";

/** A picture's file as sent fitted, in a provider encoding or a PNG. */
export function fileKey(cid: string, fit: Fit, encode: ProviderEncoding | null): string {
  return `file|${cid}|${fit.mode}|${fit.width}x${fit.height}|${encodingOf(encode)}`;
}

/** The hashes row a fitted copy's hash is kept under across reloads: its cid,
 * then what made it after a slash, so the sweep keeps and drops it with the cid. */
export function fileRow(cid: string, fit: Fit, encode: ProviderEncoding | null): string {
  return `${cid}/${fit.mode}|${fit.width}x${fit.height}|${encodingOf(encode)}`;
}
