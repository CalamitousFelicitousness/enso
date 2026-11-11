import { describe, expect, it } from "vitest";
import {
  applyList,
  cell,
  compose,
  diffKeys,
  diffList,
  invert,
  isEmpty,
  sameValue,
  span,
  touched,
  withoutKeys,
} from "./patch";
import { item, keys, type Item } from "./steps.fixture";

const idOf = (i: Item) => i.id;

describe("sameValue", () => {
  it("compares plain data by content", () => {
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue(Number.NaN, Number.NaN)).toBe(true);
    expect(sameValue(null, {})).toBe(false);
    expect(sameValue([], {})).toBe(false);
  });

  it("counts a key holding undefined as absent", () => {
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });

  it("compares anything but plain data by identity", () => {
    const blob = new Blob(["x"]);
    expect(sameValue({ file: blob }, { file: blob })).toBe(true);
    expect(sameValue({ file: blob }, { file: new Blob(["x"]) })).toBe(false);
    expect(sameValue(new Map(), new Map())).toBe(false);
  });
});

describe("diffKeys", () => {
  it("holds only the keys that changed", () => {
    const patch = diffKeys("s", { a: 1, b: 2, c: 3 }, { a: 1, b: 5, c: 3 }, ["a", "b", "c"]);
    expect(patch).toEqual(keys("s", { b: 2 }, { b: 5 }));
  });

  it("is null when nothing changed, a fresh but equal value included", () => {
    expect(diffKeys("s", { a: { x: 1 } }, { a: { x: 1 } }, ["a"])).toBeNull();
  });

  it("ignores keys it was not asked about", () => {
    expect(diffKeys("s", { a: 1, other: 1 }, { a: 1, other: 2 }, ["a"])).toBeNull();
  });

  it("keeps a group together when one of its keys changed", () => {
    const groups = [["lut", "hash"]];
    const patch = diffKeys(
      "s",
      { lut: "a", hash: null },
      { lut: "b", hash: null },
      ["lut", "hash"],
      {
        groups,
      },
    );
    expect(patch).toEqual(keys("s", { lut: "a", hash: null }, { lut: "b", hash: null }));
  });

  it("compares a key by its own equality when given one", () => {
    const equal = {
      model: (a: unknown, b: unknown) =>
        (a as { name: string }).name === (b as { name: string }).name,
    };
    const before = { model: { name: "m", at: 1 } };
    const after = { model: { name: "m", at: 2 } };
    expect(diffKeys("s", before, after, ["model"], { equal })).toBeNull();
  });
});

describe("diffList", () => {
  const a = item("a", 1);
  const b = item("b", 1);

  it("holds changed items by id, without order when membership and order stay", () => {
    const a2 = item("a", 2);
    const patch = diffList(
      "l",
      { items: [a, b], keys: {} },
      { items: [a2, b], keys: {} },
      idOf,
      [],
    );
    expect(patch?.items).toEqual({ a: { before: a, after: a2 } });
    expect(patch?.order).toBeNull();
  });

  it("holds an added or removed item with null on the side it was absent, and the order", () => {
    const patch = diffList("l", { items: [a], keys: {} }, { items: [a, b], keys: {} }, idOf, []);
    expect(patch?.items).toEqual({ b: { before: null, after: b } });
    expect(patch?.order).toEqual({ before: ["a"], after: ["a", "b"] });
  });

  it("holds the order alone when items only moved", () => {
    const patch = diffList("l", { items: [a, b], keys: {} }, { items: [b, a], keys: {} }, idOf, []);
    expect(patch?.items).toEqual({});
    expect(patch?.order).toEqual({ before: ["a", "b"], after: ["b", "a"] });
  });

  it("leaves out an item rebuilt with the same content", () => {
    const patch = diffList(
      "l",
      { items: [a], keys: {} },
      { items: [item("a", 1)], keys: {} },
      idOf,
      [],
    );
    expect(patch).toBeNull();
  });

  it("holds the slice's keys beside the items", () => {
    const patch = diffList(
      "l",
      { items: [a], keys: { source: 1 } },
      { items: [a], keys: { source: 2 } },
      idOf,
      ["source"],
    );
    expect(patch?.keys).toEqual({ before: { source: 1 }, after: { source: 2 } });
  });
});

describe("withoutKeys", () => {
  it("drops the given keys and a patch left empty, and leaves list patches alone", () => {
    const list = diffList("l", { items: [], keys: {} }, { items: [item("a")], keys: {} }, idOf, []);
    if (!list) throw new Error("expected a patch");
    const patches = [
      keys("m", { model: "A" }, { model: "B" }),
      keys("s", { model: 1, n: 1 }, { model: 2, n: 2 }),
      list,
    ];
    expect(withoutKeys(patches, new Set([cell("m", "model"), cell("s", "n")]))).toEqual([
      keys("s", { model: 1 }, { model: 2 }),
      list,
    ]);
  });

  it("returns the same patch when it holds none of the keys", () => {
    const patch = keys("s", { n: 1 }, { n: 2 });
    expect(withoutKeys([patch], new Set([cell("m", "model")]))[0]).toBe(patch);
  });
});

describe("applyList", () => {
  const a = item("a", 1);
  const b = item("b", 1);
  const c = item("c", 1);

  it("goes back and forth to the identical items in their order", () => {
    const before = { items: [a, b, c], keys: { k: 1 } };
    const after = { items: [c, item("a", 2)], keys: { k: 2 } };
    const patch = diffList("l", before, after, idOf, ["k"]);
    if (!patch) throw new Error("expected a patch");
    const back = applyList(after, patch, "before", idOf);
    expect(back.items).toEqual([a, b, c]);
    back.items.forEach((x, i) => expect(x).toBe(before.items[i]));
    expect(back.keys).toEqual({ k: 1 });
    const forth = applyList(back, patch, "after", idOf);
    forth.items.forEach((x, i) => expect(x).toBe(after.items[i]));
  });

  it("keeps the current order and items the patch does not hold", () => {
    const patch = diffList(
      "l",
      { items: [a], keys: {} },
      { items: [item("a", 2)], keys: {} },
      idOf,
      [],
    );
    if (!patch) throw new Error("expected a patch");
    const now = { items: [b, item("a", 2)], keys: {} };
    expect(applyList(now, patch, "before", idOf).items).toEqual([b, a]);
  });
});

describe("compose", () => {
  it("joins two changes into one from the first before to the second after", () => {
    const one = keys("s", { t: "" }, { t: "a" });
    const two = keys("s", { t: "a", n: 1 }, { t: "ab", n: 2 });
    expect(compose([one], [two])).toEqual([keys("s", { t: "", n: 1 }, { t: "ab", n: 2 })]);
  });

  it("leaves out a slice that ends where it began", () => {
    expect(compose([keys("s", { t: "" }, { t: "a" })], [keys("s", { t: "a" }, { t: "" })])).toEqual(
      [],
    );
  });

  it("joins list changes by item and order", () => {
    const a = item("a", 1);
    const b = item("b", 1);
    const first = diffList("l", { items: [a], keys: {} }, { items: [a, b], keys: {} }, idOf, []);
    const second = diffList("l", { items: [a, b], keys: {} }, { items: [a], keys: {} }, idOf, []);
    if (!first || !second) throw new Error("expected patches");
    expect(compose([first], [second])).toEqual([]);
  });
});

describe("span", () => {
  it("goes from where one change ends to where another from the same start ends", () => {
    const now = keys("s", { t: "" }, { t: "ab" });
    const tip = keys("s", { t: "" }, { t: "abc" });
    expect(span([now], [tip])).toEqual([keys("s", { t: "ab" }, { t: "abc" })]);
  });

  it("covers keys only one of them changed", () => {
    const now = keys("s", { t: "", n: 1 }, { t: "a", n: 2 });
    const tip = keys("s", { t: "" }, { t: "abc" });
    expect(span([now], [tip])).toEqual([keys("s", { t: "a", n: 2 }, { t: "abc", n: 1 })]);
  });
});

describe("invert, isEmpty, touched", () => {
  it("inverts a list patch's items, order and keys", () => {
    const a = item("a");
    const patch = diffList(
      "l",
      { items: [], keys: { k: 1 } },
      { items: [a], keys: { k: 2 } },
      idOf,
      ["k"],
    );
    if (!patch) throw new Error("expected a patch");
    const back = invert(patch);
    expect(back).toEqual({
      slice: "l",
      kind: "list",
      items: { a: { before: a, after: null } },
      order: { before: ["a"], after: [] },
      keys: { before: { k: 2 }, after: { k: 1 } },
    });
    expect(invert(back)).toEqual(patch);
  });

  it("knows an empty patch of either kind", () => {
    expect(isEmpty(keys("s", {}, {}))).toBe(true);
    expect(
      isEmpty({
        slice: "l",
        kind: "list",
        items: {},
        order: null,
        keys: { before: {}, after: {} },
      }),
    ).toBe(true);
  });

  it("names what a patch touches by slice", () => {
    const a = item("a");
    const list = diffList("l", { items: [], keys: {} }, { items: [a], keys: {} }, idOf, []);
    if (!list) throw new Error("expected a patch");
    expect([...touched([keys("s", { x: 1 }, { x: 2 }), list])].sort()).toEqual(
      ["l\u0000#a", "l\u0000#order", "s\u0000x"].sort(),
    );
  });
});
