import { describe, expect, it } from "vitest";
import { assignIdentities } from "./identity";

describe("assignIdentities", () => {
  it("continues an extended region", () => {
    expect(assignIdentities([{ area: 120, overlaps: [{ id: "a", pixels: 100 }] }])).toEqual(["a"]);
  });

  it("gives a region over nothing a new identity", () => {
    expect(assignIdentities([{ area: 50, overlaps: [] }])).toEqual([null]);
  });

  it("lets a merged region continue the old region it shares most pixels with", () => {
    const out = assignIdentities([
      {
        area: 300,
        overlaps: [
          { id: "small", pixels: 40 },
          { id: "big", pixels: 200 },
        ],
      },
    ]);
    expect(out).toEqual(["big"]);
  });

  it("continues a split region through its largest fragment only", () => {
    const out = assignIdentities([
      { area: 20, overlaps: [{ id: "a", pixels: 20 }] },
      { area: 90, overlaps: [{ id: "a", pixels: 90 }] },
    ]);
    expect(out).toEqual([null, "a"]);
  });

  it("does not let a sliver with a bigger box outrank a solid fragment", () => {
    // A 1-pixel-wide L covering the whole box against a solid block: pixel
    // overlap decides, not bounding-box size.
    const out = assignIdentities([
      { area: 199, overlaps: [{ id: "a", pixels: 199 }] },
      { area: 3600, overlaps: [{ id: "a", pixels: 3600 }] },
    ]);
    expect(out).toEqual([null, "a"]);
  });

  it("ignores zero-pixel overlaps", () => {
    expect(assignIdentities([{ area: 10, overlaps: [{ id: "a", pixels: 0 }] }])).toEqual([null]);
  });

  it("assigns each old identity at most once across untouched regions", () => {
    const out = assignIdentities([
      { area: 10, overlaps: [{ id: "a", pixels: 10 }] },
      { area: 10, overlaps: [{ id: "b", pixels: 10 }] },
    ]);
    expect(out).toEqual(["a", "b"]);
  });
});
