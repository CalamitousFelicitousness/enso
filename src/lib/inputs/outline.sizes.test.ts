import { describe, expect, it } from "vitest";
import type { Declaration } from "@/lib/media/rules";
import type { SizeLimits, SizeRule } from "@/lib/media/sizeRule";
import { fileSpec } from "./freshness";
import { frame, layer, picture } from "./frames.fixture";
import { compositeDraw, computeOutline, type OutlineEnv, type ProcessingEnv } from "./outline";
import { fixProblem } from "./problems";
import { defaultIpAdapter } from "./reducers";
import { fixLabel, problemText, sentSizeLine, sentSizeTitle, sentSizeValue } from "./text";
import type { Frame } from "./types";

const QWEN: SizeRule = { kind: "area", area: 1024 * 1024, multiple: 32, round: "nearest" };
const CLIP: SizeRule = { kind: "shortest", side: 224 };

const declared = (rule: SizeRule | null, limits?: SizeLimits): Declaration => ({
  kind: "declared",
  declared: { rule, ...(limits ? { limits } : {}) },
});

const env = (
  reference: Declaration,
  patch: Partial<OutlineEnv> = {},
  ipAdapter: Declaration = { kind: "unknown" },
): OutlineEnv => ({
  requestSetsSize: true,
  sizes: { reference, ipAdapter, target: { width: 1328, height: 1328 } },
  ...patch,
});

const photo = (id: string, width: number, height: number) => picture(id, { width, height });

describe("sent sizes of a set's members", () => {
  it("fits a reference larger than the rule's size and keeps a smaller one whole", () => {
    const outline = computeOutline(
      [frame("refs", "reference", photo("big", 6000, 4000), photo("small", 800, 600))],
      env(declared(QWEN)),
    );
    const [big, small] = outline.sent;
    expect(big.fit).toEqual({ width: 1248, height: 832, mode: "stretch" });
    expect(big.sentSize).toEqual({
      kind: "fitted",
      size: { width: 1248, height: 832 },
      from: { width: 6000, height: 4000 },
    });
    expect(small.fit).toBeNull();
    expect(small.sentSize).toEqual({
      kind: "whole",
      size: { width: 800, height: 600 },
      why: "fits",
    });
  });

  it("carries the sent size into the frame's slots", () => {
    const outline = computeOutline(
      [frame("refs", "reference", photo("big", 6000, 4000), photo("small", 800, 600))],
      env(declared(QWEN)),
    );
    expect(outline.entries[0].slots.map((s) => s.sentSize?.kind)).toEqual(["fitted", "whole"]);
  });

  it("fits nothing outside a set: a lone Reference the model generates from", () => {
    const outline = computeOutline(
      [frame("refs", "reference", photo("big", 6000, 4000))],
      env(declared(QWEN), { requestSetsSize: false }),
    );
    expect(outline.set).toBe(false);
    expect(outline.sent[0].fit).toBeNull();
    expect(outline.sent[0].sentSize).toBeNull();
  });

  it("fits nothing without the size facts", () => {
    const outline = computeOutline(
      [frame("refs", "reference", photo("a", 6000, 4000), photo("b", 6000, 4000))],
      { requestSetsSize: true },
    );
    expect(outline.sent.map((s) => [s.fit, s.sentSize])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("says why a picture goes whole: no rule, not reported, or not known yet", () => {
    const frames = [frame("refs", "reference", photo("big", 6000, 4000))];
    const why = (d: Declaration) => computeOutline(frames, env(d)).sent[0].sentSize;
    expect(why(declared(null))).toMatchObject({ kind: "whole", why: "noRule" });
    expect(why({ kind: "unreported" })).toMatchObject({ kind: "whole", why: "unreported" });
    expect(why({ kind: "unknown" })).toEqual({
      kind: "unknown",
      size: { width: 6000, height: 4000 },
    });
  });

  it("draws a set's Initial composite at the rule's size of the generation size", () => {
    const outline = computeOutline(
      [frame("init", "initial", layer("m")), frame("refs", "reference", photo("r", 640, 480))],
      env(declared(QWEN)),
    );
    expect(outline.sent[0].fit).toEqual({ width: 1024, height: 1024, mode: "stretch" });
    expect(outline.sent[0].sentSize).toMatchObject({
      kind: "fitted",
      from: { width: 1328, height: 1328 },
    });
  });

  it("gives no sent size to a picture over the input limit", () => {
    const outline = computeOutline(
      [frame("refs", "reference", photo("huge", 20000, 20000), photo("r", 640, 480))],
      env(declared(QWEN), { inputLimit: { pixels: 89_000_000, by: "server" } }),
    );
    expect(outline.sent[0].sentSize).toBeNull();
    expect(outline.sent[1].sentSize).not.toBeNull();
  });
});

describe("sent sizes of IP-Adapter pictures", () => {
  const adapter = (crop: boolean): Frame => ({
    ...frame("ip", "ipAdapter", photo("face", 1000, 500)),
    ipAdapter: { ...defaultIpAdapter(), adapter: "Base", crop },
  });

  it("fits a picture to the encoder's shortest side", () => {
    const outline = computeOutline([adapter(false)], env({ kind: "unknown" }, {}, declared(CLIP)));
    expect(outline.ipAdapters[0].fits).toEqual([{ width: 448, height: 224, mode: "stretch" }]);
    expect(outline.entries[0].slots[0].sentSize).toMatchObject({ kind: "fitted" });
  });

  it("sends the whole picture with Crop, which looks for the face in it", () => {
    const outline = computeOutline([adapter(true)], env({ kind: "unknown" }, {}, declared(CLIP)));
    expect(outline.ipAdapters[0].fits).toEqual([null]);
    expect(outline.ipAdapters[0].sentSizes[0]).toMatchObject({ kind: "whole", why: "crop" });
  });
});

describe("the maps of fitted pictures", () => {
  const processing: ProcessingEnv = {
    revision: "r1",
    defaults: { canny: {} },
    current: new Set<string>(),
    lookedUp: new Set<string>(),
    pending: new Map(),
    failed: new Map(),
    cloud: false,
    stamp: 0,
    frame: { width: 1024, height: 1024 },
    target: { width: 1328, height: 1328 },
  };
  const processed = (pictures: ReturnType<typeof photo>[]): Frame => ({
    ...frame("refs", "reference", ...pictures),
    processor: { id: "canny", params: {} },
  });

  it("names the fitted size in the map's spec and leaves a whole picture's spec as before", () => {
    const outline = computeOutline(
      [processed([photo("big", 6000, 4000), photo("small", 800, 600)])],
      env(declared(QWEN), { processing }),
    );
    const [big, small] = outline.sent;
    expect(big.map?.spec).toEqual({
      kind: "file",
      cid: "cid-big",
      out: { width: 1248, height: 832, mode: "stretch" },
    });
    expect(small.map?.spec).toEqual(fileSpec({ cid: "cid-small" }));
    expect(small.map?.spec).toEqual({ kind: "file", cid: "cid-small" });
  });

  it("draws a set's Initial composite at a stretch fit's size, and crops a cover fit after", () => {
    const init: Frame = {
      ...frame("init", "initial", layer("m")),
      processor: { id: "canny", params: {} },
    };
    const refs = frame("refs", "reference", photo("r", 640, 480));
    // placed in a larger frame, so neither drawn size is the frame's own
    const placed = { processing: { ...processing, frame: { width: 1600, height: 1600 } } };
    const stretch = computeOutline([init, refs], env(declared(QWEN), placed));
    const spec = stretch.sent[0].map?.spec;
    expect(spec?.kind === "composite" && spec.out).toEqual({ width: 1024, height: 1024 });
    expect(spec).not.toHaveProperty("fit");

    const joy: SizeRule = {
      kind: "buckets",
      sizes: [{ width: 1024, height: 768 }],
      fit: "cover",
      ratio: "h/w",
      aspectMultiple: 1,
    };
    const cover = computeOutline([init, refs], env(declared(joy), placed));
    expect(cover.sent[0].map?.spec).toMatchObject({
      kind: "composite",
      out: { width: 1328, height: 1328 },
      fit: { width: 1024, height: 768, mode: "cover" },
    });
  });
});

describe("compositeDraw", () => {
  const target = { width: 1328, height: 1328 };
  it("draws at the output size without a fit", () => {
    expect(compositeDraw(null, target)).toEqual({ drawnAt: target, fit: null });
  });
  it("draws at a stretch fit's size, with nothing after", () => {
    expect(compositeDraw({ width: 1024, height: 1024, mode: "stretch" }, target)).toEqual({
      drawnAt: { width: 1024, height: 1024 },
      fit: null,
    });
  });
  it("draws at the output size and crops a cover fit after", () => {
    const fit = { width: 1024, height: 768, mode: "cover" as const };
    expect(compositeDraw(fit, target)).toEqual({ drawnAt: target, fit });
  });
});

describe("pictures the model refuses", () => {
  const limits = { minSide: 64, maxAspect: 8 };

  it("refuses a set member outside the declared limits, with words and a fix", () => {
    const frames = [frame("refs", "reference", photo("strip", 40, 4000))];
    const outline = computeOutline(frames, env(declared(null, limits)));
    const problem = outline.problems.find((p) => p.code === "ruleRefused");
    expect(problem).toBeDefined();
    if (!problem) return;
    expect(problemText(problem)).toBe(
      "This model takes pictures at least 64 px on each side and at most 8:1; Image 1 is 40×4000.",
    );
    expect(fixLabel(problem)).toBe("Hide Image 1");
    expect(outline.entries[0].blockedBy).toContain("ruleRefused");
    const fixed = fixProblem(frames, problem);
    expect(fixed[0].pictures[0].visible).toBe(false);
  });

  it("checks the size that goes out, not the picture's own", () => {
    // 6000x4000 is fitted to 1248x832, inside the limits
    const outline = computeOutline(
      [frame("refs", "reference", photo("big", 6000, 4000))],
      env(declared(QWEN, limits)),
    );
    expect(outline.problems.map((p) => p.code)).not.toContain("ruleRefused");
  });

  it("leaves a Crop adapter picture to the server", () => {
    const frames: Frame[] = [
      {
        ...frame("ip", "ipAdapter", photo("strip", 40, 4000)),
        ipAdapter: { ...defaultIpAdapter(), adapter: "Base", crop: true },
      },
    ];
    const outline = computeOutline(frames, env({ kind: "unknown" }, {}, declared(null, limits)));
    expect(outline.problems.map((p) => p.code)).not.toContain("ruleRefused");
  });
});

describe("the words of a sent size", () => {
  const fitted = {
    kind: "fitted",
    size: { width: 1024, height: 768 },
    from: { width: 6000, height: 4500 },
  } as const;
  const whole = { kind: "whole", size: { width: 4000, height: 3000 }, why: "noRule" } as const;

  it("gives the row's line, its title and the dock's value", () => {
    expect(sentSizeLine(fitted)).toBe("1024×768 (from 6000×4500)");
    expect(sentSizeTitle(fitted)).toBe(
      "Sent at 1024×768, resized from 6000×4500 to the size this model uses",
    );
    expect(sentSizeValue(fitted)).toBe("1024×768 of 6000×4500");
    expect(sentSizeLine(whole)).toBe("4000×3000, full size");
    expect(sentSizeValue(whole)).toBe("4000×3000 full");
    expect(sentSizeTitle({ ...whole, why: "crop" })).toBe(
      "Sent at full size: Crop looks for the face in the whole picture",
    );
    expect(sentSizeLine({ kind: "unknown", size: { width: 4000, height: 3000 } })).toBe(
      "4000×3000",
    );
  });
});

describe("the most a picture goes out at to a provider", () => {
  const cloud = {
    rule: { kind: "longest", side: 2048, multiple: 8 } as const,
    target: { width: 1024, height: 1024 },
  };

  it("says the provider's longest side for every sent picture, set or not", () => {
    const outline = computeOutline(
      [frame("init", "initial", layer("m")), frame("refs", "reference", photo("r", 6000, 4500))],
      { cloud },
    );
    expect(outline.sent.map((s) => s.sentSize)).toEqual([
      { kind: "atMost", size: { width: 1024, height: 1024 }, from: { width: 1024, height: 1024 } },
      { kind: "atMost", size: { width: 2048, height: 1536 }, from: { width: 6000, height: 4500 } },
    ]);
    expect(outline.sent.every((s) => s.fit === null)).toBe(true);
    const lone = computeOutline([frame("refs", "reference", photo("r", 640, 480))], { cloud });
    expect(lone.sent[0].sentSize).toMatchObject({ kind: "atMost" });
  });

  it("words it as at most, with where it came from when it shrinks", () => {
    const shrunk = {
      kind: "atMost",
      size: { width: 2048, height: 1536 },
      from: { width: 6000, height: 4500 },
    } as const;
    const same = { ...shrunk, size: shrunk.from };
    expect(sentSizeLine(shrunk)).toBe("at most 2048×1536 (from 6000×4500)");
    expect(sentSizeLine(same)).toBe("at most 6000×4500");
    expect(sentSizeValue(shrunk)).toBe("at most 2048×1536 of 6000×4500");
    expect(sentSizeTitle(same)).toBe(
      "Sent at most at 6000×4500; the provider's file size limit can lower it",
    );
  });
});
