import { describe, expect, it } from "vitest";
import type { PixelSize } from "./dimensions";
import {
  fitTo,
  roundHalfEven,
  ruleRefusal,
  ruleSize,
  type DeclaredSize,
  type SizeRule,
} from "./sizeRule";
import { GOLDEN, JOY_SIZES, KONTEXT_SIZES } from "./sizeRule.golden";

const sizes = (list: [number, number][]) => list.map(([width, height]) => ({ width, height }));

// As SD.Next declares them.
const QWEN: SizeRule = { kind: "area", area: 1024 * 1024, multiple: 32, round: "nearest" };
const FLUX2: DeclaredSize = {
  rule: { kind: "cap", area: 1024 * 1024 },
  limits: { minSide: 64, maxAspect: 8 },
};
const KONTEXT: SizeRule = {
  kind: "buckets",
  sizes: sizes(KONTEXT_SIZES),
  fit: "stretch",
  ratio: "w/h",
  aspectMultiple: 16,
};
const JOY: SizeRule = {
  kind: "buckets",
  sizes: sizes(JOY_SIZES),
  fit: "cover",
  ratio: "h/w",
  aspectMultiple: 1,
};
const CLIP: SizeRule = { kind: "shortest", side: 224 };

const size = (width: number, height: number): PixelSize => ({ width, height });

describe("ruleSize against each pipeline's own answer", () => {
  const rules: [string, SizeRule][] = [
    ["Qwen area", QWEN],
    ["Flux2 cap", FLUX2.rule!],
    ["Kontext buckets", KONTEXT],
    ["Joy buckets", JOY],
    ["CLIP shortest side", CLIP],
  ];
  it.each(rules.map(([name, rule], i) => [name, rule, i] as const))("%s", (_name, rule, i) => {
    for (const row of GOLDEN) {
      const [w, h] = row;
      expect(ruleSize(rule, size(w, h)), `${w}x${h}`).toEqual(size(row[2 + 2 * i], row[3 + 2 * i]));
    }
  });
});

describe("fitTo", () => {
  it("sends the pipeline's answer when it shrinks the picture, else the picture whole", () => {
    for (const rule of [QWEN, FLUX2.rule!, KONTEXT, JOY, CLIP]) {
      for (const [w, h] of GOLDEN) {
        const target = ruleSize(rule, size(w, h));
        const shrinks =
          target.width <= w && target.height <= h && (target.width < w || target.height < h);
        const fit = fitTo(rule, size(w, h));
        if (shrinks) expect(fit, `${rule.kind} ${w}x${h}`).toMatchObject(target);
        else expect(fit, `${rule.kind} ${w}x${h}`).toBeNull();
      }
    }
  });

  it("rounds Qwen's halves to even, as Python does", () => {
    // sqrt(1024**2 * 4225/4096) is exactly 1040, 32.5 steps of 32
    expect(fitTo(QWEN, size(4225, 4096))).toEqual({ width: 1024, height: 1024, mode: "stretch" });
    expect(roundHalfEven(32.5)).toBe(32);
    expect(roundHalfEven(33.5)).toBe(34);
    expect(roundHalfEven(32.500001)).toBe(33);
  });

  it("settles the common photo aspects at their own fixed point", () => {
    for (const [w, h, out] of [
      [6000, 4000, size(1248, 832)],
      [5000, 5000, size(1024, 1024)],
      [7000, 3000, size(1568, 672)],
    ] as const) {
      expect(fitTo(QWEN, size(w, h))).toMatchObject(out);
      expect(ruleSize(QWEN, out)).toEqual(out);
    }
  });

  it("never enlarges a small picture", () => {
    for (const rule of [QWEN, FLUX2.rule!, KONTEXT, JOY, CLIP]) {
      expect(fitTo(rule, size(37, 23))).toBeNull();
      expect(fitTo(rule, size(200, 150))).toBeNull();
    }
  });

  it("caps above the area at the truncated size and leaves a smaller picture whole", () => {
    expect(fitTo(FLUX2.rule!, size(8192, 1024))).toEqual({
      width: 2896,
      height: 362,
      mode: "stretch",
    });
    expect(fitTo(FLUX2.rule!, size(1024, 1024))).toBeNull();
    expect(fitTo(FLUX2.rule!, size(1000, 1048))).toBeNull();
  });

  it("covers to Joy's bucket and stretches to Kontext's", () => {
    expect(fitTo(JOY, size(6000, 4000))).toEqual({ width: 1216, height: 832, mode: "cover" });
    expect(fitTo(KONTEXT, size(6000, 4000))).toEqual({ width: 1248, height: 832, mode: "stretch" });
  });

  it("maps every bucket to itself", () => {
    for (const rule of [KONTEXT, JOY] as const) {
      for (const s of rule.sizes) expect(ruleSize(rule, s)).toEqual(s);
    }
  });

  it("truncates the long side after CLIP's shortest side and stretches to SigLIP's square", () => {
    expect(fitTo(CLIP, size(1000, 3000))).toEqual({ width: 224, height: 672, mode: "stretch" });
    expect(fitTo(CLIP, size(224, 1000))).toBeNull();
    const siglip: SizeRule = { kind: "exact", width: 384, height: 384 };
    expect(fitTo(siglip, size(1000, 500))).toEqual({ width: 384, height: 384, mode: "stretch" });
    expect(fitTo(siglip, size(1000, 300))).toBeNull();
  });

  it("holds a provider's longest side, rounding the other to the multiple", () => {
    const openrouter: SizeRule = { kind: "longest", side: 2048, multiple: 8 };
    expect(fitTo(openrouter, size(4000, 3000))).toEqual({
      width: 2048,
      height: 1536,
      mode: "stretch",
    });
    expect(fitTo(openrouter, size(3001, 4001))).toEqual({
      width: 1536,
      height: 2048,
      mode: "stretch",
    });
    expect(fitTo(openrouter, size(2048, 1000))).toBeNull();
  });

  it("sends a floored size whole", () => {
    expect(fitTo({ kind: "floor", multiple: 16 }, size(1999, 1001))).toBeNull();
    expect(ruleSize({ kind: "floor", multiple: 16 }, size(1999, 1001))).toEqual(size(1984, 992));
  });
});

describe("ruleRefusal", () => {
  it("refuses a side under the minimum before an aspect over the maximum", () => {
    expect(ruleRefusal(FLUX2, size(63, 1000))).toBe("tooSmall");
    expect(ruleRefusal(FLUX2, size(8200, 1024))).toBe("tooWide");
    expect(ruleRefusal(FLUX2, size(8192, 1024))).toBeNull();
    expect(ruleRefusal({ rule: QWEN }, size(10, 10000))).toBeNull();
  });

  it("never refuses a capped fit whose original passes", () => {
    for (let i = 0; i <= 2000; i++) {
      const ratio = 8 ** ((2 * i) / 2000 - 1);
      for (const area of [1.1e6, 4e6, 24e6, 100e6]) {
        const original = size(
          Math.round(Math.sqrt(area * ratio)),
          Math.round(Math.sqrt(area / ratio)),
        );
        if (ruleRefusal(FLUX2, original)) continue;
        const fit = fitTo(FLUX2.rule!, original) ?? original;
        expect(ruleRefusal(FLUX2, fit), `${original.width}x${original.height}`).toBeNull();
      }
    }
  });
});

describe("Qwen's area rule across aspects", () => {
  it("settles two thirds of the aspects from 1:8 to 8:1 and drifts the rest by a step", () => {
    // Measured: 67.5% settle; the rest move one step of 32, two on the long side past 6:1
    const steps = 1_000_000;
    let settled = 0;
    const worst = { within6: 0, beyond6: 0 };
    for (let i = 0; i < steps; i++) {
      const ratio = 8 ** ((2 * i) / (steps - 1) - 1);
      const first = ruleSize(QWEN, size(ratio, 1));
      const second = ruleSize(QWEN, first);
      const drift = Math.max(
        Math.abs(second.width - first.width),
        Math.abs(second.height - first.height),
      );
      if (drift === 0) settled += 1;
      const band = Math.max(ratio, 1 / ratio) <= 6 ? "within6" : "beyond6";
      worst[band] = Math.max(worst[band], drift);
    }
    expect(settled / steps).toBeGreaterThan(0.67);
    expect(worst).toEqual({ within6: 32, beyond6: 64 });
  });
});
