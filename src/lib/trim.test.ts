import { describe, expect, it } from "vitest";
import { planTrim } from "./trim";

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, at: i }));
const newestFirst = (a: { at: number }, b: { at: number }) => b.at - a.at;

describe("planTrim", () => {
  it("lets go of the items past the cap in order, last first, never one it is told to keep", () => {
    const all = items(10);
    expect(planTrim(all, 6, new Set(), newestFirst)).toEqual(["i0", "i1", "i2", "i3"]);
    expect(planTrim(all, 6, new Set(["i1", "i9"]), newestFirst)).toEqual(["i0", "i2", "i3"]);
    // the order the items come in does not matter
    expect(planTrim([...all].reverse(), 6, new Set(), newestFirst)).toEqual([
      "i0",
      "i1",
      "i2",
      "i3",
    ]);
  });

  it("keeps every item under the cap", () => {
    expect(planTrim(items(6), 6, new Set(), newestFirst)).toEqual([]);
    expect(planTrim([], 0, new Set(), newestFirst)).toEqual([]);
  });

  it("leaves the items it was given in their order", () => {
    const all = items(4);
    planTrim(all, 1, new Set(), newestFirst);
    expect(all.map((i) => i.id)).toEqual(["i0", "i1", "i2", "i3"]);
  });
});
