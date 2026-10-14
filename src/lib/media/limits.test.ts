import { describe, expect, it } from "vitest";
import type { ImageHeader, ImageKind } from "./dimensions";
import {
  admission,
  DECODE_CEILING_PIXELS,
  effectiveLimit,
  refusalKey,
  sendsAsShown,
  type MediaLimits,
} from "./limits";

const header = (kind: ImageKind, width: number, height: number, orientation = 1): ImageHeader => {
  const size = { width, height };
  const oriented = orientation >= 5 ? { width: height, height: width } : size;
  return { kind, size, orientation, oriented };
};

const limits = (over: Partial<MediaLimits> = {}): MediaLimits => ({
  server: 89_000_000,
  serverKinds: new Set<ImageKind>([
    "png",
    "jpeg",
    "webp",
    "gif",
    "bmp",
    "tiff",
    "avif",
    "heic",
    "jp2",
  ]),
  browserKinds: new Set<ImageKind>(["png", "jpeg", "webp", "gif", "bmp", "avif"]),
  ignoresOrientation: new Set<ImageKind>(["webp"]),
  ...over,
});

describe("effectiveLimit", () => {
  it("takes the smaller of the browser's ceiling and the server's limit, and says whose", () => {
    expect(effectiveLimit(32_000_000)).toEqual({ pixels: 32_000_000, by: "server" });
    expect(effectiveLimit(DECODE_CEILING_PIXELS * 2)).toEqual({
      pixels: DECODE_CEILING_PIXELS,
      by: "enso",
    });
    expect(effectiveLimit(null)).toEqual({ pixels: DECODE_CEILING_PIXELS, by: "enso" });
  });
});

describe("admission", () => {
  it("refuses a file named as something else, or one the reader does not know", () => {
    expect(admission("text/plain", header("png", 10, 10), limits(), "images")).toEqual({
      ok: false,
      refusal: { reason: "notImage" },
    });
    expect(admission("image/svg+xml", { kind: "unknown" }, limits(), "process")).toEqual({
      ok: false,
      refusal: { reason: "notImage" },
    });
  });

  it("lets an unnamed or generic type through to the header", () => {
    for (const type of ["", "application/octet-stream"]) {
      expect(admission(type, header("png", 10, 10), limits(), "images").ok).toBe(true);
    }
  });

  it("refuses a picture without a size, except for PNG info", () => {
    const sizeless: ImageHeader = { kind: "jpeg", size: null };
    expect(admission("image/jpeg", sizeless, limits(), "images")).toEqual({
      ok: false,
      refusal: { reason: "noSize" },
    });
    expect(admission("image/jpeg", sizeless, limits(), "pngInfo").ok).toBe(true);
  });

  it("asks the browser where it decodes and the server where the file goes whole", () => {
    const heic = header("heic", 4000, 3000);
    expect(admission("image/heic", heic, limits(), "images")).toEqual({
      ok: false,
      refusal: { reason: "browserCannotShow", kind: "heic" },
    });
    expect(admission("image/heic", heic, limits(), "caption").ok).toBe(true);
    const jxl = header("jxl", 4000, 3000);
    expect(admission("image/jxl", jxl, limits(), "process")).toEqual({
      ok: false,
      refusal: { reason: "serverCannotRead", kind: "jxl" },
    });
    expect(admission("image/jxl", jxl, limits({ serverKinds: null }), "process").ok).toBe(true);
  });

  it("refuses a picture over the effective limit with its shown size", () => {
    expect(admission("image/jpeg", header("jpeg", 12000, 9000, 6), limits(), "images")).toEqual({
      ok: false,
      refusal: {
        reason: "tooLarge",
        size: { width: 9000, height: 12000 },
        limit: { pixels: 89_000_000, by: "server" },
      },
    });
    expect(admission("image/jpeg", header("jpeg", 9000, 9000), limits(), "process").ok).toBe(true);
    expect(
      admission("image/jpeg", header("jpeg", 12000, 9000), limits({ server: null }), "images").ok,
    ).toBe(true);
  });

  it("groups refusals by reason, kind and limit", () => {
    const big = { reason: "tooLarge", size: { width: 1, height: 1 } } as const;
    expect(refusalKey({ ...big, limit: { pixels: 9, by: "server" } })).not.toBe(
      refusalKey({ ...big, limit: { pixels: 9, by: "enso" } }),
    );
    expect(refusalKey({ reason: "browserCannotShow", kind: "heic" })).not.toBe(
      refusalKey({ reason: "browserCannotShow", kind: "jxl" }),
    );
    expect(refusalKey({ reason: "noSize" })).toBe("noSize");
  });
});

describe("sendsAsShown", () => {
  const tagged = (kind: ImageKind) =>
    header(kind, 400, 200, 6) as Extract<ImageHeader, { orientation: number }>;

  it("sends an upright picture whole when the server reads its kind", () => {
    expect(
      sendsAsShown(header("png", 4, 4) as Extract<ImageHeader, { orientation: number }>, limits()),
    ).toBe(true);
    expect(
      sendsAsShown(header("jxl", 4, 4) as Extract<ImageHeader, { orientation: number }>, limits()),
    ).toBe(false);
  });

  it("sends a tagged picture whole only where this browser and the server agree on the tag", () => {
    // Chrome and Firefox: the tag applied except on WebP, as the server does
    expect(sendsAsShown(tagged("jpeg"), limits())).toBe(true);
    expect(sendsAsShown(tagged("webp"), limits())).toBe(true);
    // WebKitGTK shows PNG and AVIF unrotated, where the server rotates them
    const webkit = limits({ ignoresOrientation: new Set<ImageKind>(["png", "webp", "avif"]) });
    expect(sendsAsShown(tagged("png"), webkit)).toBe(false);
    expect(sendsAsShown(tagged("avif"), webkit)).toBe(false);
    expect(sendsAsShown(tagged("jpeg"), webkit)).toBe(true);
  });
});
