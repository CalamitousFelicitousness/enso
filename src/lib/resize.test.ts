import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ResizeMethod } from "./resize";

// Node has no ImageData; the kernel only reads and builds data, width and height.
class Pixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

const wasm = (path: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../node_modules/@jsquash/resize/lib/${path}`, import.meta.url)),
  );

let resizePixels: (s: ImageData, w: number, h: number, m?: ResizeMethod) => Promise<ImageData>;

beforeAll(async () => {
  vi.stubGlobal("ImageData", Pixels);
  const kernel = await import("@jsquash/resize");
  await kernel.initResize(wasm("resize/pkg/squoosh_resize_bg.wasm"));
  await kernel.initMagicKernel(wasm("magic-kernel/pkg/jsquash_magic_kernel_bg.wasm"));
  ({ resizePixels } = await import("./resize"));
});

function gray(width: number, height: number, value: (x: number, y: number) => number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = value(x, y);
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return new Pixels(data, width, height) as unknown as ImageData;
}

describe("resizePixels", () => {
  it("averages in linear light by default", async () => {
    const checker = gray(16, 16, (x, y) => ((x + y) % 2 ? 255 : 0));
    const out = await resizePixels(checker, 8, 8);
    // The mean of black and white in linear light is sRGB 187.5; in sRGB, 127.5
    expect(out.data[(4 * 8 + 4) * 4]).toBeGreaterThanOrEqual(186);
    expect(out.data[(4 * 8 + 4) * 4]).toBeLessThanOrEqual(189);
  });

  it("keeps the shadows within one code", async () => {
    // Each sRGB code 0 to 32 twice across, halved: every code should come back
    const ramp = gray(66, 4, (x) => Math.floor(x / 2));
    const out = await resizePixels(ramp, 33, 2);
    for (let x = 0; x < 33; x++) expect(Math.abs(out.data[x * 4] - x)).toBeLessThanOrEqual(1);
  });

  it("leaves MKS2021 in sRGB", async () => {
    const checker = gray(16, 16, (x, y) => ((x + y) % 2 ? 255 : 0));
    const out = await resizePixels(checker, 8, 8, "magicKernelSharp2021");
    expect(Math.abs(out.data[(4 * 8 + 4) * 4] - 128)).toBeLessThanOrEqual(2);
  });
});

describe("stagedSize", () => {
  it("leaves a source within the limit alone", async () => {
    const { stagedSize } = await import("./resize");
    expect(stagedSize({ width: 4000, height: 4000 }, { width: 1024, height: 1024 })).toBeNull();
  });

  it("shrinks to twice the target when that is within the limit", async () => {
    const { stagedSize } = await import("./resize");
    expect(stagedSize({ width: 8000, height: 6000 }, { width: 1024, height: 768 })).toEqual({
      width: 2048,
      height: 1536,
    });
  });

  it("lets the limit win over twice the target", async () => {
    const { stagedSize } = await import("./resize");
    const staged = stagedSize(
      { width: 12000, height: 12000 },
      { width: 3000, height: 3000 },
      16_000_000,
    );
    expect(staged).toEqual({ width: 4000, height: 4000 });
  });
});
