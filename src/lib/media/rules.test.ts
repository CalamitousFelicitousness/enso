import { describe, expect, it } from "vitest";
import { declarationOf, declaredSize, ruleIn, sameDeclaration } from "./rules";

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

  it("compares declarations by value", () => {
    const a = declarationOf({ rule: { kind: "cap", area: 1 } });
    const b = declarationOf({ rule: { kind: "cap", area: 1 } });
    expect(sameDeclaration(a, b)).toBe(true);
    expect(sameDeclaration(a, declarationOf({ rule: null }))).toBe(false);
  });
});
