import { describe, expect, it } from "vitest";
import {
  clear,
  closeTyping,
  cut,
  emptyStacks,
  holds,
  invalidate,
  join,
  openTyping,
  record,
  recordTyping,
  redo,
  remove,
  reserve,
  touch,
  undo,
  type Press,
} from "./stacks";
import { cell } from "./patch";
import { changed, draft, editorFacts, env, facts, item, keys, made } from "./steps.fixture";
import type { Command, Draft, Stacks, Step } from "./types";

function recordAll(drafts: Draft[], stacks: Stacks = emptyStacks()): Stacks {
  return drafts.reduce((s, d) => record(s, d, env).stacks, stacks);
}

const sides = (stacks: Stacks, scope: Step["scope"] = "images") => ({
  undo: stacks.byScope[scope].undo.map((s) => s.id),
  redo: stacks.byScope[scope].redo.map((s) => s.id),
});

function replayed(press: Press) {
  if (press.action.kind !== "replay")
    throw new Error(`expected a replay, got ${press.action.kind}`);
  return press.action;
}

const command = (tags: string[] = []): Command => ({ undo: () => {}, redo: () => {}, tags });

describe("record", () => {
  it("numbers steps in order and makes the last one latest", () => {
    const stacks = recordAll([draft(), made("shared", "images"), draft()]);
    expect(sides(stacks)).toEqual({ undo: [1, 3], redo: [] });
    expect(sides(stacks, "shared")).toEqual({ undo: [2], redo: [] });
    expect(stacks.latest).toBe(3);
  });

  it("records nothing for a change with nothing in it", () => {
    const result = record(emptyStacks(), draft({ patches: [] }), env);
    expect(result.step).toBeNull();
    expect(result.stacks).toEqual(emptyStacks());
  });

  it("clears its own stack's redo side and no other", () => {
    let stacks = recordAll([draft(), made("shared", "images")]);
    stacks = undo(stacks, facts("images"), env).stacks;
    stacks = undo(stacks, facts("images"), env).stacks;
    expect(sides(stacks).redo).toEqual([1]);
    expect(sides(stacks, "shared").redo).toEqual([2]);
    const result = record(stacks, draft(), env);
    expect(sides(result.stacks).redo).toEqual([]);
    expect(sides(result.stacks, "shared").redo).toEqual([2]);
    expect(result.dropped.map((s) => s.id)).toEqual([1]);
  });

  it("drops the oldest undo-side steps over the step limit", () => {
    const small = { ...env, stepLimit: 2 };
    let stacks = emptyStacks();
    const dropped: number[] = [];
    for (let i = 0; i < 4; i++) {
      const result = record(stacks, draft(), small);
      stacks = result.stacks;
      dropped.push(...result.dropped.map((s) => s.id));
    }
    expect(sides(stacks).undo).toEqual([3, 4]);
    expect(dropped).toEqual([1, 2]);
  });

  it("counts the content ids a step names", () => {
    const a = item("a", 1, { c1: 10 });
    const b = item("a", 2, { c2: 20 });
    const { step } = record(emptyStacks(), draft({ patches: [changed("inputs", a, b)] }), env);
    expect(step?.cids).toEqual(
      new Map([
        ["c1", 10],
        ["c2", 20],
      ]),
    );
  });
});

describe("undo and redo", () => {
  it("moves the top to the other side and says which side to write", () => {
    let stacks = recordAll([draft(), draft()]);
    const first = undo(stacks, facts("images"), env);
    expect(replayed(first)).toMatchObject({ side: "before", step: { id: 2 } });
    stacks = first.stacks;
    expect(sides(stacks)).toEqual({ undo: [1], redo: [2] });
    expect(stacks.latest).toBeNull();
    const back = redo(stacks, facts("images"), env);
    expect(replayed(back)).toMatchObject({ side: "after", step: { id: 2 } });
    expect(sides(back.stacks)).toEqual({ undo: [1, 2], redo: [] });
  });

  it("does nothing with nothing in reach", () => {
    const press = undo(emptyStacks(), facts("images"), env);
    expect(press.action.kind).toBe("none");
    expect(redo(emptyStacks(), facts("images"), env).action.kind).toBe("none");
  });

  it("redoes the step moved last among those in reach", () => {
    let stacks = recordAll([draft(), made("shared", "images")]);
    stacks = undo(stacks, facts("images"), env).stacks; // shared
    stacks = undo(stacks, facts("images"), env).stacks; // images
    expect(replayed(redo(stacks, facts("images"), env)).step.id).toBe(1);
  });

  it("acts on one given step only while it is its stack's top", () => {
    const stacks = recordAll([draft(), draft()]);
    expect(undo(stacks, facts("images", { only: 1 }), env).action.kind).toBe("none");
    expect(replayed(undo(stacks, facts("gallery", { only: 2 }), env)).step.id).toBe(2);
  });
});

describe("reach", () => {
  it("takes the view's own stack, the shared stack and what was made from the view", () => {
    const stacks = recordAll([
      made("images", "images"),
      made("gallery", "images"),
      made("gallery", "gallery"),
      made("shared", "video"),
    ]);
    // from Images: images #1, gallery top #3 was made in the Gallery, shared #4
    expect(replayed(undo(stacks, facts("images"), env)).step.id).toBe(4);
    const afterShared = undo(stacks, facts("images"), env).stacks;
    expect(replayed(undo(afterShared, facts("images"), env)).step.id).toBe(1);
  });

  it("reaches a step made from the view in another view's stack", () => {
    const stacks = recordAll([made("gallery", "gallery"), made("images", "gallery")]);
    expect(replayed(undo(stacks, facts("gallery"), env)).step.id).toBe(2);
  });

  it("from a view whose document is not recorded, reaches only what was made there", () => {
    const stacks = recordAll([made("shared", "images"), made("images", "video")]);
    expect(replayed(undo(stacks, facts("video"), env)).step.id).toBe(2);
    const later = recordAll([made("shared", "images")]);
    expect(undo(later, facts("video"), env).action.kind).toBe("none");
  });

  it("cancels a newer wait in reach before any step, and ignores one out of reach", () => {
    const base = recordAll([made("shared", "images")]);
    const { stacks, id } = reserve(base);
    const wait = { id, scope: "images" as const, view: "images" as const };
    expect(undo(stacks, facts("images", { waits: [wait] }), env).action).toEqual({
      kind: "cancel",
      wait,
    });
    expect(replayed(undo(stacks, facts("gallery", { waits: [wait] }), env)).step.id).toBe(1);
  });

  it("undoes a newer step before an older wait", () => {
    const { stacks: reserved, id } = reserve(emptyStacks());
    const stacks = recordAll([draft()], reserved);
    const wait = { id, scope: "images" as const, view: "images" as const };
    expect(replayed(undo(stacks, facts("images", { waits: [wait] }), env)).step.id).toBe(2);
  });
});

describe("held steps", () => {
  const held = { undo: () => {}, commit: () => {}, until: 0 };

  it("are released by Undo and never reach the redo side", () => {
    const stacks = recordAll([made("shared", "images", { patches: [], held })]);
    const press = undo(stacks, facts("images"), env);
    expect(press.action.kind).toBe("release");
    expect(sides(press.stacks, "shared")).toEqual({ undo: [], redo: [] });
  });

  it("leave their stack when committed or released by their notice, wherever they sit", () => {
    const stacks = recordAll([
      made("shared", "images", { patches: [], held }),
      made("shared", "images"),
    ]);
    const result = remove(stacks, 1);
    expect(sides(result.stacks, "shared").undo).toEqual([2]);
    expect(result.dropped.map((s) => s.id)).toEqual([1]);
    expect(result.stacks.latest).toBe(2);
  });
});

describe("native field input", () => {
  const field = {};
  const typed = (from: string, to: string, tag: object = field) =>
    draft({ patches: [keys("settings", { classes: from }, { classes: to })], tag });

  it("joins the latest step when it carries the same tag and keys", () => {
    const stacks = recordAll([typed("", "a"), typed("a", "ab")]);
    expect(sides(stacks).undo).toEqual([1]);
    expect(stacks.byScope.images.undo[0].patches).toEqual([
      keys("settings", { classes: "" }, { classes: "ab" }),
    ]);
  });

  it("starts a step of its own after another tag, other keys or a press", () => {
    expect(sides(recordAll([typed("", "a"), typed("a", "ab", {})])).undo).toEqual([1, 2]);
    const otherKeys = draft({
      patches: [keys("settings", { steps: 1 }, { steps: 2 })],
      tag: field,
    });
    expect(sides(recordAll([typed("", "a"), otherKeys])).undo).toEqual([1, 2]);
    let stacks = recordAll([typed("", "a"), made("shared", "images")]);
    stacks = undo(stacks, facts("images"), env).stacks;
    stacks = redo(stacks, facts("images"), env).stacks;
    expect(sides(recordAll([typed("a", "ab")], stacks)).undo).toHaveLength(2);
  });

  it("drops the step when the field is typed back to where it began", () => {
    const stacks = recordAll([typed("", "a"), typed("a", "")]);
    expect(sides(stacks).undo).toEqual([]);
    expect(stacks.latest).toBeNull();
  });
});

describe("typing runs", () => {
  const editor = {};
  const step = (from: string, to: string) =>
    draft({ patches: [keys("settings", { prompt: from }, { prompt: to })] });
  const type = (
    stacks: Stacks,
    from: string,
    to: string,
    kind: "input" | "undo" | "redo" = "input",
  ) => recordTyping(stacks, step(from, to), { editor, textAtOpen: "", kind }, env).stacks;
  const prompt = (s: Step | null | undefined) => {
    const patch = s?.patches[0];
    return patch?.kind === "keys" ? patch.after["prompt"] : undefined;
  };

  it("extends the open run, and moves its tip only on typed changes", () => {
    let stacks = type(emptyStacks(), "", "a");
    stacks = type(stacks, "a", "ab");
    stacks = type(stacks, "ab", "a", "undo");
    const run = openTyping(stacks);
    expect(sides(stacks).undo).toEqual([1]);
    expect(prompt(run)).toBe("a");
    expect(run?.typing?.tip).toEqual([keys("settings", { prompt: "" }, { prompt: "ab" })]);
  });

  it("lets the editor undo while it can, numbering the move", () => {
    const stacks = type(type(emptyStacks(), "", "a"), "a", "ab");
    const press = undo(stacks, facts("images", { editor: editorFacts({ canUndo: true }) }), env);
    expect(press.action.kind).toBe("editor");
    expect(openTyping(press.stacks)?.moved).toBe(2);
  });

  it("closes the run when the editor cannot undo, replays it and keeps what was stepped back from", () => {
    let stacks = type(type(emptyStacks(), "", "a"), "a", "ab");
    stacks = type(stacks, "ab", "a", "undo");
    const press = undo(stacks, facts("images", { editor: editorFacts() }), env);
    const action = replayed(press);
    expect(prompt(action.step)).toBe("a");
    expect(action.step.typing).toBeNull();
    const redoSide = press.stacks.byScope.images.redo;
    expect(redoSide.map((s) => s.patches)).toEqual([
      [keys("settings", { prompt: "a" }, { prompt: "ab" })],
      [keys("settings", { prompt: "" }, { prompt: "a" })],
    ]);
  });

  it("drops a run back at its start and acts on the next step in reach", () => {
    let stacks = recordAll([made("shared", "images")]);
    stacks = type(stacks, "", "a");
    stacks = type(stacks, "a", "", "undo");
    const press = undo(stacks, facts("images", { editor: editorFacts({ atOpen: true }) }), env);
    expect(replayed(press).step.id).toBe(1);
    expect(sides(press.stacks).undo).toEqual([]);
    expect(press.stacks.byScope.images.redo.map((s) => s.patches)).toEqual([
      [keys("settings", { prompt: "" }, { prompt: "a" })],
    ]);
  });

  it("does nothing and keeps the run open when it is back at its start and nothing else is in reach", () => {
    let stacks = type(emptyStacks(), "", "a");
    stacks = type(stacks, "a", "", "undo");
    const press = undo(stacks, facts("images", { editor: editorFacts({ atOpen: true }) }), env);
    expect(press.action.kind).toBe("none");
    expect(press.stacks).toBe(stacks);
  });

  it("closes when another step is recorded; in another stack it keeps the stepped-back part", () => {
    let stacks = type(type(emptyStacks(), "", "a"), "a", "ab");
    stacks = type(stacks, "ab", "a", "undo");
    const other = record(stacks, made("shared", "images"), env, editorFacts());
    expect(openTyping(other.stacks)).toBeNull();
    // the stepped-back part takes the next number, the shared step the one after
    expect(sides(other.stacks)).toEqual({ undo: [1], redo: [2] });
    expect(sides(other.stacks, "shared").undo).toEqual([3]);
    const same = record(stacks, draft(), env, editorFacts());
    expect(sides(same.stacks)).toEqual({ undo: [1, 2], redo: [] });
  });

  it("closes on hide, keeping the run and the stepped-back part", () => {
    let stacks = type(type(emptyStacks(), "", "a"), "a", "ab");
    stacks = type(stacks, "ab", "a", "undo");
    const closed = closeTyping(stacks, editorFacts(), env).stacks;
    expect(openTyping(closed)).toBeNull();
    expect(sides(closed)).toEqual({ undo: [1], redo: [2] });
    const back = replayed(redo(closed, facts("images"), env));
    expect(back.side).toBe("after");
    expect(prompt(back.step)).toBe("ab");
  });

  it("redoes inside the editor while it can and it moved last", () => {
    let stacks = type(type(emptyStacks(), "", "a"), "a", "ab");
    stacks = undo(stacks, facts("images", { editor: editorFacts({ canUndo: true }) }), env).stacks;
    const press = redo(stacks, facts("images", { editor: editorFacts({ canRedo: true }) }), env);
    expect(press.action.kind).toBe("editor");
  });

  it("is closed by a press that moves another step, keeping the stepped-back part", () => {
    let stacks = recordAll([made("gallery", "gallery")]);
    stacks = type(type(stacks, "", "a"), "a", "ab");
    stacks = type(stacks, "ab", "a", "undo");
    const press = undo(stacks, facts("gallery", { editor: editorFacts() }), env);
    expect(replayed(press).step.id).toBe(1);
    expect(openTyping(press.stacks)).toBeNull();
    expect(sides(press.stacks)).toEqual({ undo: [2], redo: [3] });
  });
});

describe("join", () => {
  const f0 = item("f", 0);
  const f1 = item("f", 1, { stroke: 1 });
  const f2 = item("f", 2, { bake: 50 });
  const stroke = draft({ patches: [changed("inputs", f0, f1)] });

  it("joins the newest step that touches the item when its after is the item written over", () => {
    const stacks = recordAll([stroke, draft()]);
    const result = join(
      stacks,
      [{ scope: "images", slice: "inputs", id: "f", from: f1, to: f2 }],
      env,
    );
    const step = result.stacks.byScope.images.undo[0];
    expect(step.patches).toEqual([changed("inputs", f0, f2)]);
    expect(step.cids).toEqual(new Map([["bake", 50]]));
  });

  it("joins nothing when the newest step's after is not the item written over", () => {
    const stacks = recordAll([stroke]);
    const result = join(
      stacks,
      [{ scope: "images", slice: "inputs", id: "f", from: item("f", 1), to: f2 }],
      env,
    );
    expect(result.stacks).toEqual(stacks);
  });

  it("moves the before of the nearest redo-side step that touches the item", () => {
    const g = item("f", 3);
    let stacks = recordAll([stroke, draft({ patches: [changed("inputs", f1, g)] })]);
    stacks = undo(stacks, facts("images"), env).stacks;
    const result = join(
      stacks,
      [{ scope: "images", slice: "inputs", id: "f", from: f1, to: f2 }],
      env,
    );
    expect(result.stacks.byScope.images.undo[0].patches).toEqual([changed("inputs", f0, f2)]);
    expect(result.stacks.byScope.images.redo[0].patches).toEqual([changed("inputs", f2, g)]);
  });

  it("drops a step the join leaves changing nothing", () => {
    const stacks = recordAll([stroke]);
    const result = join(
      stacks,
      [{ scope: "images", slice: "inputs", id: "f", from: f1, to: item("f", 0) }],
      env,
    );
    expect(sides(result.stacks).undo).toEqual([]);
    expect(result.dropped.map((s) => s.id)).toEqual([1]);
    expect(result.stacks.latest).toBeNull();
  });
});

describe("cut", () => {
  const named = (cid: string, v: number) =>
    draft({ patches: [changed("inputs", item("f", v), item("f", v + 1, { [cid]: 1 }))] });

  it("drops the newest undo-side step naming a cid with every older one", () => {
    const stacks = recordAll([draft(), named("x", 0), draft(), draft()]);
    const result = cut(stacks, new Set(["x"]));
    expect(sides(result.stacks).undo).toEqual([3, 4]);
    expect(result.dropped.map((s) => s.id)).toEqual([1, 2]);
  });

  it("drops the redo-side step nearest to now naming a cid with every later one", () => {
    let stacks = recordAll([draft(), named("x", 0), draft()]);
    for (let i = 0; i < 3; i++) stacks = undo(stacks, facts("images"), env).stacks;
    // redo side: furthest first [3, 2, 1]
    const result = cut(stacks, new Set(["x"]));
    expect(sides(result.stacks).redo).toEqual([1]);
  });

  it("leaves stacks that name none alone", () => {
    const stacks = recordAll([made("shared", "images"), named("x", 0)]);
    expect(sides(cut(stacks, new Set(["x"])).stacks, "shared").undo).toEqual([1]);
  });
});

describe("invalidate, clear, holds", () => {
  it("drops a step whose only work needs a gone item, and keeps a step's own changes", () => {
    const stacks = recordAll([
      made("gallery", "gallery", { patches: [], commands: [command(["file:1"])] }),
      draft({ commands: [command(["file:1"]), command(["file:2"])] }),
    ]);
    const result = invalidate(stacks, new Set(["file:1"]));
    expect(sides(result.stacks, "gallery").undo).toEqual([]);
    expect(result.stacks.byScope.images.undo[0].commands.map((c) => c.tags)).toEqual([["file:2"]]);
    expect(result.dropped.map((s) => s.id)).toEqual([1]);
  });

  it("clears one scope", () => {
    const stacks = recordAll([draft(), made("shared", "images")]);
    const result = clear(stacks, "images");
    expect(sides(result.stacks)).toEqual({ undo: [], redo: [] });
    expect(sides(result.stacks, "shared").undo).toEqual([2]);
    expect(result.stacks.latest).toBe(2);
  });

  it("holds every cid a step names on either side", () => {
    let stacks = recordAll([
      draft({ patches: [changed("inputs", item("f", 0, { a: 1 }), item("f", 1, { b: 1 }))] }),
      draft({ patches: [changed("inputs", item("g", 0), item("g", 1, { c: 1 }))] }),
    ]);
    stacks = undo(stacks, facts("images"), env).stacks;
    expect([...holds(stacks)].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("checked keys", () => {
  const MODEL = cell("model", "activeModel");
  const checking = { ...env, checked: new Set([MODEL]) };
  const pick = (from: string, to: string) =>
    made("shared", "images", {
      patches: [keys("model", { activeModel: from }, { activeModel: to })],
    });
  const restore = (from: string, to: string) =>
    draft({ riders: [keys("model", { activeModel: from }, { activeModel: to })] });
  const rec = (stacks: Stacks, d: Draft) => record(stacks, d, checking).stacks;

  it("move with the step that wrote them last", () => {
    let stacks = rec(rec(emptyStacks(), pick("a", "b")), restore("b", "c"));
    expect(stacks.owners[MODEL]).toBe(2);
    const first = undo(stacks, facts("images"), checking);
    expect(replayed(first)).toMatchObject({ step: { id: 2 }, gaveUp: [] });
    stacks = first.stacks;
    expect(stacks.owners[MODEL]).toBe(1);
    const back = redo(stacks, facts("images"), checking);
    expect(replayed(back).gaveUp).toEqual([]);
    expect(back.stacks.owners[MODEL]).toBe(2);
  });

  it("are given up for good by a step another write buried", () => {
    // from the Gallery only the pick is in reach, and the restore wrote after it
    const stacks = rec(rec(emptyStacks(), pick("a", "b")), restore("b", "c"));
    const press = undo(stacks, facts("gallery"), checking);
    expect(press.action.kind).toBe("none");
    expect(sides(press.stacks, "shared")).toEqual({ undo: [], redo: [] });
    expect(press.dropped.map((s) => s.id)).toEqual([1]);
    expect(press.stacks.owners[MODEL]).toBe(2);
  });

  it("are given up by a step with more in it, which still moves", () => {
    let stacks = rec(emptyStacks(), restore("a", "b"));
    stacks = undo(stacks, facts("images"), checking).stacks;
    stacks = rec(stacks, pick("a", "c"));
    const press = redo(stacks, facts("images"), checking);
    const action = replayed(press);
    expect(action.gaveUp).toEqual([MODEL]);
    expect(action.step.riders).toEqual([]);
    expect(action.step.patches).toHaveLength(1);
    expect(press.stacks.owners[MODEL]).toBe(3);
  });

  it("are lost to every step once a write no step made lands", () => {
    const stacks = touch(rec(emptyStacks(), pick("a", "b")), [MODEL]);
    expect(undo(stacks, facts("images"), checking).action.kind).toBe("none");
  });

  it("are not redone over a write no step made", () => {
    let stacks = rec(emptyStacks(), pick("a", "b"));
    stacks = undo(stacks, facts("images"), checking).stacks;
    stacks = touch(stacks, [MODEL]);
    const press = redo(stacks, facts("images"), checking);
    expect(press.action.kind).toBe("none");
    expect(sides(press.stacks, "shared")).toEqual({ undo: [], redo: [] });
  });
});

describe("the step limit when a typing run closes", () => {
  it("drops the oldest undo-side step when the stepped-back part takes the stack over", () => {
    const small = { ...env, stepLimit: 3 };
    const editor = {};
    const typed = (stacks: Stacks, from: string, to: string, kind: "input" | "undo") =>
      recordTyping(
        stacks,
        draft({ patches: [keys("settings", { prompt: from }, { prompt: to })] }),
        { editor, textAtOpen: "", kind },
        small,
      ).stacks;
    let stacks = [draft(), draft()].reduce((s, d) => record(s, d, small).stacks, emptyStacks());
    stacks = typed(typed(typed(stacks, "", "a", "input"), "a", "ab", "input"), "ab", "a", "undo");
    const closed = closeTyping(stacks, editorFacts(), small);
    expect(sides(closed.stacks)).toEqual({ undo: [2, 3], redo: [4] });
    expect(closed.dropped.map((s) => s.id)).toEqual([1]);
  });
});
