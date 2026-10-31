import { describe, expect, it } from "vitest";
import { skipApplies } from "./skip";

describe("Skip on a generate job", () => {
  it("acts on a job that makes no maps", () => {
    expect(skipApplies({ mapKeys: [], mapsArrived: false })).toBe(true);
  });

  it("waits while the job's maps are made", () => {
    expect(skipApplies({ mapKeys: ["Canny|1|{}|a"], mapsArrived: false })).toBe(false);
  });

  it("acts once the maps event arrived", () => {
    expect(skipApplies({ mapKeys: ["Canny|1|{}|a", "Depth|1|{}|b"], mapsArrived: true })).toBe(
      true,
    );
  });
});
