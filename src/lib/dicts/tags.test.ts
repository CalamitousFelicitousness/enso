import { describe, expect, it } from "vitest";
import {
  columnsFromRows,
  findTags,
  mergeColumns,
  NO_TAGS,
  packColumns,
  unpackColumns,
  type DictColumns,
} from "./tags";

const rows = (...r: [string, number, number][]) => r;
const plain = (c: DictColumns) =>
  c.names.map((name, i) => [name, c.categories[i], c.counts[i]] as const);

describe("columnsFromRows", () => {
  it("sorts by code unit and keeps a repeated name's highest count", () => {
    const columns = columnsFromRows(
      rows(["b_c", 0, 5], ["B", 1, 9], ["a", 4, 1], ["b_c", 3, 7], ["a_", 0, 2], ["a", 2, 1]),
    );
    expect(plain(columns)).toEqual([
      ["B", 1, 9],
      ["a", 4, 1],
      ["a_", 0, 2],
      ["b_c", 3, 7],
    ]);
  });

  it("drops a name holding a newline", () => {
    expect(columnsFromRows(rows(["x\ny", 0, 1], ["z", 0, 1])).names).toEqual(["z"]);
  });
});

describe("mergeColumns", () => {
  const a = columnsFromRows(rows(["cat", 0, 10], ["dog", 0, 3], ["owl", 1, 4]));
  const b = columnsFromRows(rows(["cat", 4, 50], ["cow", 0, 2], ["owl", 2, 4]));
  const c = columnsFromRows(rows(["ant", 0, 1], ["dog", 5, 8]));

  it("keeps the entry with the higher count, the earlier dictionary's on a tie", () => {
    expect(plain(mergeColumns([a, b, c]))).toEqual([
      ["ant", 0, 1],
      ["cat", 4, 50],
      ["cow", 0, 2],
      ["dog", 5, 8],
      ["owl", 1, 4],
    ]);
  });

  it("returns a lone dictionary as it is, and nothing for none", () => {
    expect(mergeColumns([a])).toBe(a);
    expect(mergeColumns([])).toBe(NO_TAGS);
  });
});

describe("packColumns", () => {
  it("round-trips, empty included", () => {
    const columns = columnsFromRows(rows(["a", 1, 2], ["b", 3, 4]));
    expect(unpackColumns(packColumns(columns))).toEqual(columns);
    expect(unpackColumns(packColumns(NO_TAGS))).toEqual(NO_TAGS);
  });

  it("refuses a record of another shape", () => {
    expect(unpackColumns({ tags: [{ name: "a", category: 0, count: 1 }] })).toBeNull();
    expect(
      unpackColumns({ names: "a\nb", categories: new Uint8Array(1), counts: new Float64Array(1) }),
    ).toBeNull();
    expect(unpackColumns(null)).toBeNull();
  });
});

describe("findTags", () => {
  const columns = columnsFromRows(
    rows(
      ["long_hair", 0, 900],
      ["long_sleeves", 0, 500],
      ["longcat", 4, 3],
      ["blonde_hair", 0, 800],
      ["hair_ornament", 0, 300],
      ["very_long_hair", 0, 400],
    ),
  );

  it("finds names starting with the query, by name, up to the limit", () => {
    expect(findTags(columns, "long", 10).map((t) => t.name)).toEqual([
      "long_hair",
      "long_sleeves",
      "longcat",
    ]);
    expect(findTags(columns, "long", 2).map((t) => t.name)).toEqual(["long_hair", "long_sleeves"]);
    expect(findTags(columns, "longcat", 10)[0]).toEqual({ name: "longcat", category: 4, count: 3 });
  });

  it("falls back to names containing a query of 4 or more characters, most used first", () => {
    expect(findTags(columns, "_hair", 10).map((t) => t.name)).toEqual([
      "long_hair",
      "blonde_hair",
      "very_long_hair",
    ]);
    // the first two by name, then most used first
    expect(findTags(columns, "_hair", 2).map((t) => t.name)).toEqual(["long_hair", "blonde_hair"]);
    expect(findTags(columns, "air", 10)).toEqual([]);
    expect(findTags(columns, "zzzz", 10)).toEqual([]);
  });

  it("finds nothing in no dictionaries", () => {
    expect(findTags(NO_TAGS, "long", 10)).toEqual([]);
  });
});
