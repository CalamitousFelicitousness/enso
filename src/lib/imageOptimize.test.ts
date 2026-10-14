import { describe, expect, it } from "vitest";
import type { InputLimits } from "@/api/types/cloud";
import {
  cloudRule,
  optimizeImageForProvider,
  type OptimizeTools,
  type ShownHeader,
} from "./imageOptimize";

const LIMITS: InputLimits = {
  maxImageBytes: 20_000_000,
  maxLongestSide: 2048,
  formats: ["webp", "jpeg", "png"],
  transport: "base64",
};

const jpeg = (width: number, height: number, orientation = 1): ShownHeader => ({
  kind: "jpeg",
  orientation,
  size: { width, height },
});

/** Tools that count the decodes: a redraw and a search, each a decode. */
function counting(header: ShownHeader | null) {
  const calls = { fit: [] as string[], search: [] as Blob[] };
  const tools: OptimizeTools = {
    header: () => Promise.resolve(header),
    fit: (_blob, _size, fit) => {
      calls.fit.push(`${fit.width}x${fit.height}`);
      return Promise.resolve(new Blob(["fitted"]));
    },
    search: (picture, _limits, _label, warnings) => {
      calls.search.push(picture);
      return Promise.resolve({
        blob: picture,
        format: "jpeg",
        quality: 0.92,
        dimensions: { width: 1, height: 1 },
        warnings,
      });
    },
  };
  return { tools, calls };
}

describe("optimizeImageForProvider", () => {
  it("passes a file the provider takes through without a decode", async () => {
    const source = new Blob(["photo"], { type: "image/jpeg" });
    const { tools, calls } = counting(jpeg(1000, 800));
    const out = await optimizeImageForProvider(source, LIMITS, "openrouter", tools);
    expect(out.blob).toBe(source);
    expect(out.dimensions).toEqual({ width: 1000, height: 800 });
    expect(calls.fit).toEqual([]);
    expect(calls.search).toEqual([]);
  });

  it("decodes once a file with an orientation to apply", async () => {
    const source = new Blob(["photo"]);
    const { tools, calls } = counting(jpeg(800, 1000, 6));
    await optimizeImageForProvider(source, LIMITS, "openrouter", tools);
    expect(calls.fit).toEqual([]);
    expect(calls.search).toEqual([source]);
  });

  it("redraws a picture above the longest side once, then searches that copy", async () => {
    const { tools, calls } = counting(jpeg(6000, 4500));
    const out = await optimizeImageForProvider(new Blob(["photo"]), LIMITS, "openrouter", tools);
    expect(calls.fit).toEqual(["2048x1536"]);
    expect(await calls.search[0]?.text()).toBe("fitted");
    expect(out.warnings).toEqual(["Resized from 6000×4500 to 2048×1536 (provider max 2048px)"]);
  });

  it("searches a file in a format the provider does not take, or over its bytes", async () => {
    const gif = counting({ kind: "gif", orientation: 1, size: { width: 64, height: 64 } });
    await optimizeImageForProvider(new Blob(["gif"]), LIMITS, "openrouter", gif.tools);
    expect(gif.calls.search).toHaveLength(1);

    const big = counting(jpeg(64, 64));
    const tight = { ...LIMITS, maxImageBytes: 10 };
    await optimizeImageForProvider(new Blob(["more than seven bytes"]), tight, "x", big.tools);
    expect(big.calls.search).toHaveLength(1);
  });

  it("searches the file as it is when its header gives no size", async () => {
    const source = new Blob(["?"]);
    const { tools, calls } = counting(null);
    await optimizeImageForProvider(source, LIMITS, "openrouter", tools);
    expect(calls.search).toEqual([source]);
  });
});

describe("cloudRule", () => {
  it("is the provider's longest side, or none", () => {
    expect(cloudRule(LIMITS)).toEqual({ kind: "longest", side: 2048, multiple: 8 });
    expect(cloudRule({ ...LIMITS, maxLongestSide: null })).toBeNull();
  });
});
