// What the browser and the server can take, in pixels, and the door every
// picture passes before anything decodes it.

import type { ImageHeader, ImageKind, PixelSize } from "./dimensions";

/** The largest picture any input path decodes, the same in every browser:
 * under Firefox's 530 MP, the lowest of the three engines (Chrome and WebKit
 * stop near 537 MP). */
export const DECODE_CEILING_PIXELS = 500_000_000;

/** The largest canvas Chrome and WebKit allocate, by area at any side up to
 * 65535; a send above it is refused, since such a canvas draws nothing. */
export const CANVAS_CEILING_PIXELS = 16384 * 16384;

/** Above this a picture is shown from a bitmap decoded at this size, not from
 * the full image. */
export const DISPLAY_PIXELS = 16_000_000;

/** From here a decode can take a second (a photo's JPEG in Chrome), so the
 * entry says it is reading. */
export const SLOW_DECODE_PIXELS = 100_000_000;

/** Where a picture is going: the destinations that decode it in the browser
 * and those that send the file for the server to decode. */
export type Destination =
  | "images"
  | "ipMask"
  | "video"
  | "cloud"
  | "process"
  | "caption"
  | "interrogate"
  | "vision"
  | "pngInfo";

const SERVER_DECODED: ReadonlySet<Destination> = new Set<Destination>([
  "process",
  "caption",
  "interrogate",
  "vision",
  "pngInfo",
]);

export interface MediaLimits {
  /** The server's largest input picture, null until it answers. */
  server: number | null;
  /** The kinds the server decodes, null until it answers. */
  serverKinds: ReadonlySet<ImageKind> | null;
  /** The kinds this browser decodes, from its own probe. */
  browserKinds: ReadonlySet<ImageKind>;
  /** The kinds this browser shows without applying their orientation tag, from its probe. */
  ignoresOrientation: ReadonlySet<ImageKind>;
}

export interface EffectiveLimit {
  pixels: number;
  /** Whose limit it is, for the words. */
  by: "enso" | "server";
}

export function effectiveLimit(server: number | null): EffectiveLimit {
  return server !== null && server < DECODE_CEILING_PIXELS
    ? { pixels: server, by: "server" }
    : { pixels: DECODE_CEILING_PIXELS, by: "enso" };
}

export type Refusal =
  | { reason: "notImage" }
  | { reason: "noSize" }
  | { reason: "browserCannotShow"; kind: ImageKind }
  | { reason: "serverCannotRead"; kind: ImageKind }
  | { reason: "tooLarge"; size: PixelSize; limit: EffectiveLimit };

export type Admission =
  { ok: true; header: Exclude<ImageHeader, { kind: "unknown" }> } | { ok: false; refusal: Refusal };

/** A type that says the file is something other than an image. A missing or
 * generic type says nothing: the server sends results and gallery files it
 * has no type for as octet-stream, and the browser may still decode them. */
export function namedAsOther(type: string): boolean {
  return type !== "" && type !== "application/octet-stream" && !type.startsWith("image/");
}

/** A picture over the effective limit, as shown (orientation applied). */
export function tooLarge(size: PixelSize, server: number | null): Refusal | null {
  const limit = effectiveLimit(server);
  return size.width * size.height > limit.pixels ? { reason: "tooLarge", size, limit } : null;
}

/** Whether a file of `type` with this header may enter `where`. PNG info,
 * which only reads metadata on the server, takes a file whose size the
 * header does not give. */
export function admission(
  type: string,
  header: ImageHeader,
  limits: MediaLimits,
  where: Destination,
): Admission {
  if (namedAsOther(type) || header.kind === "unknown") {
    return { ok: false, refusal: { reason: "notImage" } };
  }
  const serverDecodes = SERVER_DECODED.has(where);
  if (header.size === null && where !== "pngInfo") {
    return { ok: false, refusal: { reason: "noSize" } };
  }
  if (!serverDecodes && !limits.browserKinds.has(header.kind)) {
    return { ok: false, refusal: { reason: "browserCannotShow", kind: header.kind } };
  }
  if (serverDecodes && limits.serverKinds && !limits.serverKinds.has(header.kind)) {
    return { ok: false, refusal: { reason: "serverCannotRead", kind: header.kind } };
  }
  const refusal = header.size === null ? null : tooLarge(header.oriented, limits.server);
  return refusal ? { ok: false, refusal } : { ok: true, header };
}

/** Refusals that read as one toast: the same reason, kind and limit. */
export function refusalKey(refusal: Refusal): string {
  switch (refusal.reason) {
    case "browserCannotShow":
    case "serverCannotRead":
      return `${refusal.reason}:${refusal.kind}`;
    case "tooLarge":
      return `tooLarge:${refusal.limit.by}:${refusal.limit.pixels}`;
    default:
      return refusal.reason;
  }
}

/** The kinds whose orientation tag the server leaves alone: no browser applies WebP's. */
export const SERVER_IGNORES_ORIENTATION: ReadonlySet<ImageKind> = new Set<ImageKind>(["webp"]);

/** Whether a picture can go as its own file and still reach the model as this
 * browser shows it: the server reads its kind and treats its orientation tag
 * as the browser did. Otherwise the copy sent is drawn from the decode. */
export function sendsAsShown(
  header: Extract<ImageHeader, { orientation: number }>,
  limits: MediaLimits,
): boolean {
  if (limits.serverKinds && !limits.serverKinds.has(header.kind)) return false;
  if (header.orientation === 1) return true;
  return limits.ignoresOrientation.has(header.kind) === SERVER_IGNORES_ORIENTATION.has(header.kind);
}
