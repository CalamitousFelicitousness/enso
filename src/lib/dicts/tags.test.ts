import { describe, expect, it } from "vitest";
import {
  columnsFromContent,
  findTags,
  mergeColumns,
  NO_TAGS,
  packColumns,
  unpackColumns,
  type DictColumns,
} from "./tags";

const plain = (c: DictColumns) =>
  c.names.map((name, i) => [name, c.categories[i], c.counts[i]] as const);

describe("columnsFromContent", () => {
  it("sorts by code unit, lowercases, and keeps a repeated name's highest count", () => {
    const columns = columnsFromContent([
      ["b_c", 0, 5],
      ["B", 1, 9],
      ["a", 4, 1],
      ["b_c", 3, 7],
      ["a_", 0, 2],
      ["a", 2, 1],
    ]);
    expect(plain(columns)).toEqual([
      ["a", 4, 1],
      ["a_", 0, 2],
      ["b", 1, 9],
      ["b_c", 3, 7],
    ]);
  });

  it("drops a name or term holding a newline and rows of another shape", () => {
    const columns = columnsFromContent(
      [["x\ny", 0, 1], ["z", 0, 1, ["q\nr", "zz"]], "junk", ["w", "0", 1]],
      { "a\nb": "z", ok: "z", gone: "missing" },
    );
    expect(columns.names).toEqual(["z"]);
    expect(columns.aliases.keys).toEqual(["zz"]);
    expect(columns.translations.keys).toEqual(["ok"]);
  });
});

describe("mergeColumns", () => {
  const a = columnsFromContent([
    ["cat", 0, 10],
    ["dog", 0, 3],
    ["owl", 1, 4],
  ]);
  const b = columnsFromContent([
    ["cat", 4, 50, ["kitty"]],
    ["cow", 0, 2],
    ["owl", 2, 4],
  ]);
  const c = columnsFromContent([
    ["ant", 0, 1],
    ["dog", 5, 8, ["pup"]],
  ]);

  it("keeps the entry with the higher count, the earlier dictionary's on a tie", () => {
    expect(plain(mergeColumns([a, b, c]))).toEqual([
      ["ant", 0, 1],
      ["cat", 4, 50],
      ["cow", 0, 2],
      ["dog", 5, 8],
      ["owl", 1, 4],
    ]);
  });

  it("points every alias at the merged tag of its name", () => {
    const merged = mergeColumns([a, b, c]);
    const target = (key: string) =>
      merged.names[merged.aliases.targets[merged.aliases.keys.indexOf(key)]];
    expect(target("kitty")).toBe("cat");
    expect(target("pup")).toBe("dog");
  });

  it("returns nothing for no dictionaries", () => {
    expect(mergeColumns([])).toBe(NO_TAGS);
  });
});

describe("packColumns", () => {
  it("round-trips, empty included", () => {
    const columns = columnsFromContent(
      [
        ["a", 1, 2, ["aa"]],
        ["b", 3, 4],
      ],
      { ä: "a" },
    );
    expect(unpackColumns(packColumns(columns))).toEqual(columns);
    const none = columnsFromContent([]);
    expect(unpackColumns(packColumns(none))).toEqual(none);
  });

  it("refuses a record of another shape or with a term pointing past the tags", () => {
    expect(unpackColumns({ names: "a", categories: new Uint8Array(1) })).toBeNull();
    const packed = packColumns(columnsFromContent([["a", 0, 1, ["b"]]]));
    expect(unpackColumns({ ...packed, aliasTargets: Uint32Array.of(5) })).toBeNull();
    expect(unpackColumns(null)).toBeNull();
  });
});

// The ranking spec shared with sdnext's own autocomplete: same fixture, same lists.
describe("findTags", () => {
  const index = mergeColumns([
    columnsFromContent(
      [
        ["breasts", 0, 900],
        ["large_breasts", 0, 800],
        ["small_breasts", 0, 500],
        ["breast_grab", 0, 400],
        ["huge_breasts", 0, 300],
        ["breasts_out", 0, 100],
        ["covered_nipples", 0, 200],
        ["1girl", 0, 7000, ["1girls"]],
        ["highres", 8, 6000, ["high_res", "hires"]],
        ["hires_(texture)", 0, 5],
        ["hatsune_miku_(cosplay)", 4, 50],
        ["long_hair", 0, 3000],
        ["ass", 0, 1000],
        ["glasses", 0, 600],
        ["class", 0, 20],
      ],
      { 巨乳: "large_breasts" },
    ),
  ]);
  const names = (typed: string, limit = 50) => findTags(index, typed, limit).map((t) => t.name);

  it.each([
    ["breasts", ["breasts", "large_breasts", "small_breasts", "huge_breasts", "breasts_out"]],
    [
      "breast",
      ["breasts", "large_breasts", "small_breasts", "breast_grab", "huge_breasts", "breasts_out"],
    ],
    ["1girls", ["1girl"]],
    ["hires", ["highres", "hires_(texture)"]],
    ["high", ["highres"]],
    ["cosplay", ["hatsune_miku_(cosplay)"]],
    ["nipples", ["covered_nipples"]],
    ["ass", ["ass"]],
    ["lass", ["glasses", "class"]],
    ["ng_hai", ["long_hair"]],
    ["res", []],
    ["Large Breasts", ["large_breasts"]],
    ["巨乳", ["large_breasts"]],
  ])("%s", (typed, expected) => {
    expect(names(typed)).toEqual(expected);
  });

  it("names the alias or translation a tag was found by", () => {
    expect(findTags(index, "1girls", 5)[0]).toEqual({
      name: "1girl",
      category: 0,
      count: 7000,
      via: "1girls",
    });
    expect(findTags(index, "巨乳", 5)[0].via).toBe("巨乳");
    expect(findTags(index, "high", 5)[0].via).toBeUndefined();
  });

  it("cuts at the limit, best tiers first", () => {
    expect(names("breasts", 3)).toEqual(["breasts", "large_breasts", "small_breasts"]);
  });

  it("merges two dictionaries by the spec's rule", () => {
    const merged = mergeColumns([
      columnsFromContent([["cat", 0, 10]]),
      columnsFromContent([["cat", 4, 50, ["kitty"]]]),
    ]);
    expect(findTags(merged, "cat", 5)).toEqual([{ name: "cat", category: 4, count: 50 }]);
    expect(findTags(merged, "kitty", 5).map((t) => t.name)).toEqual(["cat"]);
  });

  it("finds nothing in no dictionaries", () => {
    expect(findTags(NO_TAGS, "long", 10)).toEqual([]);
  });
});
