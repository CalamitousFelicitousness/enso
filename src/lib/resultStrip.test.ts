import { describe, expect, it } from "vitest";
import {
  clampStripLimit,
  migrateGeneration,
  splitAtLimit,
  STRIP_LIMIT_DEFAULT,
  withResult,
} from "./resultStrip";

describe("strip limit", () => {
  it("the persist migrate spreads the state and clamps the limit", () => {
    expect(migrateGeneration({ prompt: "a cat", steps: 9, historyLimit: 0 })).toEqual({
      prompt: "a cat",
      steps: 9,
      historyLimit: STRIP_LIMIT_DEFAULT,
    });
    expect(migrateGeneration({ historyLimit: 50 })).toEqual({ historyLimit: 50 });
    expect(migrateGeneration({ historyLimit: 500 })).toEqual({ historyLimit: 100 });
    expect(migrateGeneration(null)).toEqual({ historyLimit: STRIP_LIMIT_DEFAULT });
    expect(clampStripLimit(Number.NaN)).toBe(STRIP_LIMIT_DEFAULT);
    expect(clampStripLimit(7.6)).toBe(8);
  });

  it("the strip's trim arithmetic", () => {
    const results = ["a", "b", "c", "d"].map((id) => ({ id }));
    expect(splitAtLimit(results, 3)).toEqual({ kept: results.slice(0, 3), removed: [{ id: "d" }] });
    expect(splitAtLimit(results, 10).removed).toEqual([]);
    // a result routed twice takes its place once, at the front
    expect(withResult(results, { id: "c" }).map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
  });
});
