import { describe, expect, it } from "vitest";
import {
  effectiveSizeMode,
  imageOutputSize,
  referenceSetsSize,
  resolveGenerationSize,
  resolveOutputSize,
  snapSize,
} from "./sizeCompute";

const initialSlot = { role: "initial" } as const;
const referenceSlot = (_index: number) => ({ role: "reference" }) as const;

describe("effectiveSizeMode", () => {
  it("applies the size mode while Fit sizes the frame from an input image", () => {
    expect(effectiveSizeMode("megapixel", true, [initialSlot], true)).toBe("megapixel");
    expect(effectiveSizeMode("scale", true, [referenceSlot(0), referenceSlot(1)], true)).toBe(
      "scale",
    );
  });

  it("sends the frame size with Fit off or no input image", () => {
    expect(effectiveSizeMode("megapixel", false, [initialSlot], true)).toBe("fixed");
    expect(effectiveSizeMode("megapixel", true, [], true)).toBe("fixed");
  });

  it("sizes a lone Reference from the image only where the model does", () => {
    expect(effectiveSizeMode("megapixel", true, [referenceSlot(0)], true)).toBe("fixed");
    expect(effectiveSizeMode("megapixel", true, [referenceSlot(0)], false)).toBe("megapixel");
  });
});

describe("referenceSetsSize", () => {
  it("takes the image's size on a local model the request does not size", () => {
    expect(referenceSetsSize(true, false)).toBe(true);
    expect(referenceSetsSize(true, null)).toBe(true);
  });

  it("takes the requested size where the request sets it, and on a cloud model", () => {
    expect(referenceSetsSize(true, true)).toBe(false);
    expect(referenceSetsSize(false, null)).toBe(false);
  });
});

describe("imageOutputSize", () => {
  it("rounds each side up to the multiple, as the server does", () => {
    expect(imageOutputSize({ width: 1001, height: 700 }, 8)).toEqual({ width: 1008, height: 704 });
    expect(imageOutputSize({ width: 1024, height: 1024 }, 32)).toEqual({
      width: 1024,
      height: 1024,
    });
  });
});

describe("snapSize", () => {
  it("rounds to the nearest multiple", () => {
    expect(snapSize(1000, 8)).toBe(1000);
    expect(snapSize(1000, 16)).toBe(1008);
    expect(snapSize(1000, 32)).toBe(992);
  });

  it("keeps at least 64 pixels, on the multiple", () => {
    expect(snapSize(10, 8)).toBe(64);
    expect(snapSize(10, 48)).toBe(96);
  });
});

describe("resolveGenerationSize", () => {
  it("snaps a fixed size to the model's multiple", () => {
    expect(resolveGenerationSize("fixed", 1000, 1000, 1, 1, 16)).toEqual({
      width: 1008,
      height: 1008,
    });
  });

  it("sizes Megapixel on the model's multiple", () => {
    expect(resolveGenerationSize("megapixel", 2752, 1536, 1, 1, 8)).toEqual({
      width: 1336,
      height: 744,
    });
    expect(resolveGenerationSize("megapixel", 2752, 1536, 1, 1, 32)).toEqual({
      width: 1344,
      height: 736,
    });
  });
});

describe("resolveOutputSize", () => {
  it("rounds a hires size down to the multiple, as the server does", () => {
    expect(resolveOutputSize({ width: 1000, height: 1000 }, true, 1.5, 0, 0, 8)).toEqual({
      width: 1496,
      height: 1496,
    });
    expect(resolveOutputSize({ width: 1008, height: 1008 }, true, 1.5, 0, 0, 16)).toEqual({
      width: 1504,
      height: 1504,
    });
  });

  it("is the generation size without hires", () => {
    expect(resolveOutputSize({ width: 1008, height: 1008 }, false, 2, 0, 0, 16)).toEqual({
      width: 1008,
      height: 1008,
    });
  });
});
