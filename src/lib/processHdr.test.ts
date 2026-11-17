import { describe, expect, it } from "vitest";
import type { HdrSupport } from "@/api/types/process";
import {
  HDR_IMAGES_ONLY,
  HDR_NEEDS_SAVE,
  HDR_NO_FORMAT,
  HDR_NO_STEP,
  hdrState,
} from "./processHdr";

// As /sdapi/v2/postprocess/scripts returned it on sdnext 79e668cf0
const row = (
  format: string,
  hdr: string | null,
  ext: string | null,
  encoder: string | null,
  available: boolean,
  rest: Partial<HdrSupport> = {},
): HdrSupport => ({
  samples_format: format,
  hdr_format: hdr,
  extension: ext,
  encoder,
  available,
  installs: false,
  replaces_output: false,
  code: null,
  reason: null,
  ...rest,
});
const SERVER: HdrSupport[] = [
  row("jpg", "jpeg-gain-map", "jpg", "ultrahdr_app", false, {
    code: "encoder-missing",
    reason: "ultrahdr_app is not installed",
  }),
  row("png", "png-cicp", "png", "opencv", true),
  row("webp", null, null, null, false, {
    code: "format-unsupported",
    reason: 'image file format "webp" is not a supported HDR format',
  }),
  row("tiff", "tiff16", "tiff", "tifffile", true),
  row("avif", "avif", "avif", "imagecodecs", true, { installs: true }),
  row("exr", "exr", "exr", "OpenEXR", true, { installs: true, replaces_output: true }),
];

describe("hdrState", () => {
  it("runs on image and batch inputs only", () => {
    expect(hdrState(SERVER, "png", "folder", true)).toEqual({
      applies: false,
      hint: HDR_IMAGES_ONLY,
    });
    expect(hdrState(SERVER, "png", "video", true)).toEqual({
      applies: false,
      hint: HDR_IMAGES_ONLY,
    });
    expect(hdrState(SERVER, "png", "batch", true).applies).toBe(true);
  });

  it("asks for saving when outputs are not saved", () => {
    expect(hdrState(SERVER, "png", "image", false)).toEqual({
      applies: false,
      hint: HDR_NEEDS_SAVE,
    });
  });

  it("shows the controls with no line while the server's table or the format loads", () => {
    expect(hdrState(undefined, "png", "image", true)).toEqual({ applies: true, note: "" });
    expect(hdrState(SERVER, undefined, "image", true)).toEqual({ applies: true, note: "" });
  });

  it("says when the server has no HDR step", () => {
    expect(hdrState([], "png", "image", true)).toEqual({ applies: false, hint: HDR_NO_STEP });
  });

  it("names the file a usable format writes", () => {
    expect(hdrState(SERVER, "png", "image", true)).toEqual({
      applies: true,
      note: "Writes a 16-bit HDR PNG beside each saved image, ending in -hdr.png.",
    });
  });

  it("says when the first run installs the encoder", () => {
    expect(hdrState(SERVER, "avif", "image", true)).toEqual({
      applies: true,
      note: "Writes an HDR AVIF beside each saved image, ending in -hdr.avif. The first run installs imagecodecs on the server.",
    });
  });

  it("names the missing encoder and the formats that work without it", () => {
    expect(hdrState(SERVER, "jpg", "image", true)).toEqual({
      applies: false,
      hint: "HDR in JPG needs ultrahdr_app on the server, which is not installed. PNG, TIFF, AVIF or EXR work without it: set the image file format in Settings.",
    });
  });

  it("lists the formats that hold HDR for one that cannot, known to the server or not", () => {
    const hint =
      "WEBP images cannot hold HDR. Set the image file format to PNG, TIFF, AVIF or EXR in Settings.";
    expect(hdrState(SERVER, "webp", "image", true)).toEqual({ applies: false, hint });
    expect(
      hdrState(
        SERVER.filter((f) => f.samples_format !== "webp"),
        "webp",
        "image",
        true,
      ),
    ).toEqual({ applies: false, hint });
  });

  it("says when no format can hold HDR", () => {
    expect(
      hdrState(
        SERVER.filter((f) => !f.available),
        "webp",
        "image",
        true,
      ),
    ).toEqual({ applies: false, hint: HDR_NO_FORMAT });
  });
});
