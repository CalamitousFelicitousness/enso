import { describe, expect, it } from "vitest";
import { labelComponents } from "./components";

/** RGBA buffer from rows of characters: "." transparent, "#" opaque, digits alpha x 25. */
function grid(rows: string[]): { data: Uint8ClampedArray; width: number; height: number } {
  const width = rows[0].length;
  const height = rows.length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const alpha = ch === "#" ? 255 : ch === "." ? 0 : Number(ch) * 25;
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = alpha;
    });
  });
  return { data, width, height };
}

function alphaRows(pixels: Uint8ClampedArray, width: number, height: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) row += pixels[(y * width + x) * 4 + 3] > 0 ? "#" : ".";
    rows.push(row);
  }
  return rows;
}

describe("labelComponents", () => {
  it("finds one region with its bounds and area", () => {
    const g = grid([".....", ".##..", ".##..", "....."]);
    const { regions } = labelComponents(g.data, g.width, g.height);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ x: 1, y: 1, width: 2, height: 2, area: 4 });
  });

  it("keeps diagonally touching blobs separate under 4-connectivity", () => {
    const g = grid(["#..", ".#.", "..#"]);
    const { regions } = labelComponents(g.data, g.width, g.height);
    expect(regions).toHaveLength(3);
  });

  it("merges blobs joined by an edge", () => {
    const g = grid(["##..", ".#..", ".###"]);
    const { regions } = labelComponents(g.data, g.width, g.height);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ x: 0, y: 0, width: 4, height: 3, area: 6 });
  });

  it("drops pixels under the alpha threshold", () => {
    // "1" is alpha 25 (kept), "0" is alpha 0.
    const g = grid(["#1.", "...", "..#"]);
    const { regions } = labelComponents(g.data, g.width, g.height, 30);
    expect(regions).toHaveLength(2);
    expect(regions.map((r) => r.area)).toEqual([1, 1]);
  });

  it("copies only the region's own pixels into its box", () => {
    // Two regions whose boxes overlap: an L and a dot inside its corner.
    const g = grid(["#..", "#.#", "#..", "###"]);
    const { regions, labels } = labelComponents(g.data, g.width, g.height);
    expect(regions).toHaveLength(2);
    const l = regions.find((r) => r.area === 6)!;
    const dot = regions.find((r) => r.area === 1)!;
    expect(alphaRows(l.pixels, l.width, l.height)).toEqual(["#..", "#..", "#..", "###"]);
    expect(dot).toMatchObject({ x: 2, y: 1, width: 1, height: 1 });
    expect(labels[1 * 3 + 2]).toBe(dot.label);
  });

  it("keeps the source alpha inside a region", () => {
    const g = grid(["#5"]);
    const { regions } = labelComponents(g.data, g.width, g.height);
    expect(regions).toHaveLength(1);
    expect([...regions[0].pixels]).toEqual([255, 255, 255, 255, 255, 255, 255, 125]);
  });
});
