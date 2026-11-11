import { describe, expect, it } from "vitest";
import { evict, undoBytes } from "./budget";
import { emptyStacks, record, undo } from "./stacks";
import { changed, draft, env, facts, item, made } from "./steps.fixture";
import type { Draft, Stacks } from "./types";

/** A step that replaces item `id`'s picture `from` with `to`. */
const swap = (
  id: string,
  from: Record<string, number>,
  to: Record<string, number>,
  overrides: Partial<Draft> = {},
) => draft({ patches: [changed("inputs", item(id, 0, from), item(id, 1, to))], ...overrides });

const recordAll = (drafts: Draft[], stacks: Stacks = emptyStacks()) =>
  drafts.reduce((s, d) => record(s, d, env).stacks, stacks);

const ids = (stacks: Stacks, scope: "images" | "shared" = "images") => ({
  undo: stacks.byScope[scope].undo.map((s) => s.id),
  redo: stacks.byScope[scope].redo.map((s) => s.id),
});

describe("undoBytes", () => {
  it("counts each cid once and leaves out what a document names", () => {
    const stacks = recordAll([swap("f", { a: 10 }, { b: 20 }), swap("g", { b: 20 }, { c: 5 })]);
    expect(undoBytes(stacks, new Set())).toBe(35);
    expect(undoBytes(stacks, new Set(["c"]))).toBe(30);
  });
});

describe("evict", () => {
  it("leaves a history under the budget alone", () => {
    const stacks = recordAll([swap("f", { a: 10 }, { b: 10 })]);
    expect(evict(stacks, new Set(), 100)).toEqual({ stacks, dropped: [] });
  });

  it("drops the shortest run of oldest undo-side steps that frees bytes", () => {
    // a is named by steps 1 and 2; b by step 2 and the document
    const stacks = recordAll([
      swap("f", { a: 50 }, {}),
      swap("g", { a: 50 }, { b: 30 }),
      swap("h", {}, { c: 10 }),
    ]);
    const result = evict(stacks, new Set(["b"]), 20);
    expect(ids(result.stacks).undo).toEqual([3]);
    expect(result.dropped.map((s) => s.id)).toEqual([1, 2]);
  });

  it("never drops a side's top, so one step may stay over the budget", () => {
    const stacks = recordAll([swap("f", { a: 900 }, {})]);
    const result = evict(stacks, new Set(), 100);
    expect(ids(result.stacks).undo).toEqual([1]);
    expect(result.dropped).toEqual([]);
  });

  it("leaves a stack that holds no bytes alone", () => {
    const stacks = recordAll([
      made("shared", "images"),
      made("shared", "images"),
      swap("f", { a: 60 }, {}),
      swap("g", { b: 60 }, {}),
    ]);
    const result = evict(stacks, new Set(), 100);
    expect(ids(result.stacks, "shared").undo).toEqual([1, 2]);
    expect(ids(result.stacks).undo).toEqual([4]);
  });

  it("drops redo runs from the far end when undo sides free nothing", () => {
    let stacks = recordAll([swap("f", {}, { a: 60 }), swap("g", {}, { b: 60 }), swap("h", {}, {})]);
    for (let i = 0; i < 3; i++) stacks = undo(stacks, facts("images"), env).stacks;
    // redo side, furthest first: 3, 2, 1; step 3 frees nothing, so 3 and 2 go
    const result = evict(stacks, new Set(), 100);
    expect(ids(result.stacks).redo).toEqual([1]);
    expect(result.dropped.map((s) => s.id)).toEqual([3, 2]);
  });

  it("returns a held step it drops, so the runtime commits it", () => {
    const held = { undo: () => {}, commit: () => {}, until: 0 };
    const stacks = recordAll([
      swap(
        "f",
        { a: 60 },
        {},
        { scope: "shared", held, patches: [changed("x", item("x", 0, { a: 60 }), item("x", 1))] },
      ),
      made("shared", "images"),
    ]);
    const result = evict(stacks, new Set(), 10);
    expect(result.dropped.map((s) => s.held)).toEqual([held]);
  });
});
