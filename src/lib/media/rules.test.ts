import { describe, expect, it } from "vitest";
import { declarationOf, declaredSize, forSetOf, ruleIn, sameDeclaration } from "./rules";

describe("declarations from the server", () => {
  it("maps each rule from the wire's snake_case, buckets as width and height", () => {
    expect(
      declaredSize({
        rule: {
          kind: "buckets",
          sizes: [
            [1024, 1024],
            [1184, 880],
          ],
          fit: "stretch",
          ratio: "w/h",
          aspect_multiple: 16,
        },
        limits: { min_side: 64, max_aspect: 8 },
        output_area: 1048576,
      }),
    ).toEqual({
      rule: {
        kind: "buckets",
        sizes: [
          { width: 1024, height: 1024 },
          { width: 1184, height: 880 },
        ],
        fit: "stretch",
        ratio: "w/h",
        aspectMultiple: 16,
      },
      limits: { minSide: 64, maxAspect: 8 },
      outputArea: 1048576,
    });
  });

  it("leaves out limits and an output area the server did not give", () => {
    expect(declaredSize({ rule: { kind: "cap", area: 1048576 }, limits: null })).toEqual({
      rule: { kind: "cap", area: 1048576 },
    });
    expect(declaredSize({ rule: null })).toEqual({ rule: null });
  });

  it("tells a field never seen from a server that did not say", () => {
    expect(declarationOf(undefined)).toEqual({ kind: "unknown" });
    expect(declarationOf(null)).toEqual({ kind: "unreported" });
    const declared = declarationOf({ rule: { kind: "shortest", side: 224 } });
    expect(declared).toEqual({
      kind: "declared",
      declared: { rule: { kind: "shortest", side: 224 } },
    });
    expect(ruleIn(declared)).toEqual({ kind: "shortest", side: 224 });
    expect(ruleIn(declarationOf(null))).toBeNull();
  });

  it("applies the several-pictures rule to a set of two or more only", () => {
    const flux3 = declaredSize({
      rule: { kind: "canvas", area: 4194304, multiple: 16, min_side: 64, max_side: 4096 },
      rule_several: { kind: "cap", area: 1048576 },
    });
    expect(flux3).toEqual({
      rule: { kind: "canvas", area: 4194304, multiple: 16, minSide: 64, maxSide: 4096 },
      ruleSeveral: { kind: "cap", area: 1048576 },
    });
    const declared = declarationOf(flux3);
    expect(ruleIn(forSetOf(declared, 1))).toEqual(flux3.rule);
    expect(ruleIn(forSetOf(declared, 2))).toEqual({ kind: "cap", area: 1048576 });
    const qwen = declarationOf({ rule: { kind: "shortest", side: 224 } });
    expect(forSetOf(qwen, 3)).toBe(qwen);
    expect(forSetOf(declarationOf(null), 3)).toEqual({ kind: "unreported" });
  });

  it("compares declarations by value", () => {
    const a = declarationOf({ rule: { kind: "cap", area: 1 } });
    const b = declarationOf({ rule: { kind: "cap", area: 1 } });
    expect(sameDeclaration(a, b)).toBe(true);
    expect(sameDeclaration(a, declarationOf({ rule: null }))).toBe(false);
  });
});
