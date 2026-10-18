import { describe, expect, it } from "vitest";
import { gridColumns } from "./grid";

describe("gridColumns", () => {
  it("holds as many columns as fit at the chosen size and grows the tiles to fill", () => {
    expect(gridColumns(936, 180, 6)).toEqual({ cols: 5, size: 180 });
    expect(gridColumns(935, 180, 6)).toEqual({ cols: 4, size: 226.25 });
    expect(gridColumns(1102, 180, 6)).toEqual({ cols: 5, size: 213.2 });
  });

  it("keeps the floor of columns, with tiles below the chosen size", () => {
    expect(gridColumns(100, 180, 6)).toEqual({ cols: 1, size: 88 });
    expect(gridColumns(100, 180, 6, 2)).toEqual({ cols: 2, size: 41 });
    expect(gridColumns(0, 180, 6)).toEqual({ cols: 1, size: 0 });
  });
});
