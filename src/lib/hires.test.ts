import { describe, expect, it } from "vitest";
import {
  DEFAULT_HIRES_UPSCALER,
  PIXEL_HIRES_UPSCALER,
  effectiveHires,
  isLatentUpscaler,
} from "./hires";

const latentModel = { pixelInput: false, strength: true };
const editModel = { pixelInput: true, strength: false };

describe("isLatentUpscaler", () => {
  it("matches the names sdnext treats as latent", () => {
    expect(isLatentUpscaler("Latent Bicubic antialias")).toBe(true);
    expect(isLatentUpscaler("latent nearest")).toBe(true);
    expect(isLatentUpscaler("Diffusion Latent Upscaler 2x")).toBe(false);
    expect(isLatentUpscaler("Resize Lanczos")).toBe(false);
  });
});

describe("effectiveHires", () => {
  it("keeps valid settings on a latent-space model", () => {
    const stored = { upscaler: "Latent Nearest", force: false, denoising: 0.4 };
    expect(effectiveHires(stored, latentModel)).toEqual(stored);
  });

  it("replaces the name sdnext does not know", () => {
    const stored = { upscaler: "Latent", force: false, denoising: 0.5 };
    expect(effectiveHires(stored, latentModel).upscaler).toBe(DEFAULT_HIRES_UPSCALER);
  });

  it("takes a pixel upscaler and the second pass on a pixel-input model", () => {
    const stored = { upscaler: "Latent Nearest", force: false, denoising: 0.4 };
    expect(effectiveHires(stored, editModel)).toEqual({
      upscaler: PIXEL_HIRES_UPSCALER,
      force: true,
      denoising: 0.4,
    });
    expect(effectiveHires({ ...stored, upscaler: "Latent" }, editModel).upscaler).toBe(
      PIXEL_HIRES_UPSCALER,
    );
  });

  it("keeps a chosen pixel upscaler, and None, on a pixel-input model", () => {
    const stored = { upscaler: "ESRGAN 4x Remacri", force: false, denoising: 0.4 };
    expect(effectiveHires(stored, editModel).upscaler).toBe("ESRGAN 4x Remacri");
    expect(effectiveHires({ ...stored, upscaler: "None" }, editModel).upscaler).toBe("None");
  });

  it("does not send strength 0 where the pipeline ignores strength", () => {
    const stored = { upscaler: "Resize Lanczos", force: true, denoising: 0 };
    expect(effectiveHires(stored, editModel).denoising).toBeGreaterThan(0);
    expect(effectiveHires(stored, { pixelInput: false, strength: true }).denoising).toBe(0);
  });
});
