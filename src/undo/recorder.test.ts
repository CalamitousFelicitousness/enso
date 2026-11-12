import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { NavView } from "@/lib/constants";
import type { Draft, Scope } from "@/lib/undo/types";
import { createGestures, drivenGestures } from "./gesture";
import { createRecorder, type SettleWrite, type Sink } from "./recorder";
import { keySlice, listSlice, type ItemMove } from "./slice";

interface Item {
  id: string;
  v: number;
}

function world() {
  const settings = createStore(() => ({ steps: 20, cfg: 7, results: 0 }));
  const inputs = createStore(() => ({
    frames: [{ id: "a", v: 0 }] as Item[],
    sizeSource: null as string | null,
    selected: "a",
  }));
  const model = createStore(() => ({ activeModel: "A" }));
  const presets = createStore(() => ({ presets: [] as string[] }));
  const files = createStore(() => ({ trashed: [] as string[] }));
  const gestures = drivenGestures();
  const drafts: Draft[][] = [];
  const touched: string[][] = [];
  const joins: { scope: Scope; slice: string; moves: readonly ItemMove[] }[] = [];
  const settles: SettleWrite[] = [];
  const sink: Sink = {
    record: (d) => drafts.push([...d]),
    touch: (cells) => touched.push([...cells]),
    join: (scope, slice, moves) => joins.push({ scope, slice, moves }),
  };
  let view: NavView = "images";
  const recorder = createRecorder({
    gestures,
    sink,
    view: () => view,
    now: () => 1,
    log: { settle: (w) => settles.push(w) },
  });
  recorder.add(
    keySlice({
      name: "settings",
      scope: "images",
      store: settings,
      keys: ["steps", "cfg"],
      set: (v) => settings.setState(v),
    }),
  );
  recorder.add(
    listSlice({
      name: "inputs",
      scope: "images",
      store: inputs,
      items: (s) => s.frames,
      idOf: (f) => f.id,
      keys: ["sizeSource"],
      context: (s) => s.selected,
      set: (next) => inputs.setState({ frames: [...next.items], ...next.keys }),
    }),
  );
  recorder.add(
    keySlice({
      name: "model",
      scope: "shared",
      store: model,
      keys: ["activeModel"],
      checked: ["activeModel"],
      set: (v) => model.setState(v),
    }),
  );
  recorder.add(
    keySlice({
      name: "presets",
      scope: "shared",
      store: presets,
      keys: ["presets"],
      set: (v) => presets.setState(v),
    }),
  );
  recorder.add(
    keySlice({
      name: "files",
      scope: "gallery",
      store: files,
      keys: ["trashed"],
      set: (v) => files.setState(v),
    }),
  );
  const steps = () => drafts.flat();
  return {
    settings,
    inputs,
    model,
    presets,
    files,
    gestures,
    recorder,
    drafts,
    steps,
    touched,
    joins,
    settles,
    setView: (next: NavView) => {
      view = next;
    },
  };
}

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("recorder", () => {
  it("makes one step of a gesture's writes", () => {
    const w = world();
    w.gestures.start();
    w.settings.setState({ steps: 30 });
    w.settings.setState({ cfg: 5 });
    w.gestures.end();
    expect(w.drafts).toHaveLength(1);
    expect(w.steps()[0].patches).toEqual([
      {
        slice: "settings",
        kind: "keys",
        before: { steps: 20, cfg: 7 },
        after: { steps: 30, cfg: 5 },
      },
    ]);
    expect(w.steps()[0].view).toBe("images");
  });

  it("records nothing for an unchanged write or an unrecorded key", () => {
    const w = world();
    w.gestures.start();
    w.settings.setState({ steps: 20 });
    w.settings.setState({ results: 4 });
    w.gestures.end();
    expect(w.drafts).toEqual([]);
  });

  it("keeps a write that ends where it began out of the step", () => {
    const w = world();
    w.gestures.start();
    w.settings.setState({ steps: 30 });
    w.settings.setState({ steps: 20 });
    w.gestures.end();
    expect(w.drafts).toEqual([]);
  });

  it.each([
    ["the recorder subscribed first", true],
    ["the recorder subscribed last", false],
  ])("takes a nested write into the step when %s", (_label, recorderFirst) => {
    const settings = createStore(() => ({ steps: 20, cfg: 7 }));
    const gestures = drivenGestures();
    const drafts: Draft[] = [];
    const sink: Sink = { record: (d) => drafts.push(...d), touch: () => {}, join: () => {} };
    const recorder = createRecorder({ gestures, sink, view: () => "images" });
    const slice = keySlice({
      name: "settings",
      scope: "images",
      store: settings,
      keys: ["steps", "cfg"],
      set: (v) => settings.setState(v),
    });
    const reaction = () =>
      settings.subscribe((s) => {
        if (s.steps === 30 && s.cfg !== 1) settings.setState({ cfg: 1 });
      });
    if (recorderFirst) recorder.add(slice);
    reaction();
    if (!recorderFirst) recorder.add(slice);
    gestures.start();
    settings.setState({ steps: 30 });
    gestures.end();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].patches[0]).toMatchObject({ after: { steps: 30, cfg: 1 } });
  });

  it("takes a write a microtask later into the gesture's step", async () => {
    const w = world();
    w.gestures.start();
    w.settings.setState({ steps: 30 });
    queueMicrotask(() => w.settings.setState({ cfg: 5 }));
    await Promise.resolve();
    w.gestures.end();
    expect(w.drafts).toHaveLength(1);
    expect(w.steps()[0].patches[0]).toMatchObject({ after: { steps: 30, cfg: 5 } });
  });

  it("treats a write after the gesture as a settle write", async () => {
    const w = world();
    w.gestures.start();
    w.settings.setState({ steps: 30 });
    w.gestures.end();
    await flushMicrotasks();
    w.recorder.note("images", { kind: "late" });
    w.settings.setState({ cfg: 5 });
    expect(w.drafts).toHaveLength(1);
    expect(w.settles).toEqual([
      {
        slice: "settings",
        patch: { slice: "settings", kind: "keys", before: { cfg: 7 }, after: { cfg: 5 } },
        notes: [{ kind: "late" }],
      },
    ]);
    // the snapshot moved on: the next step starts from the settled value
    w.gestures.start();
    w.settings.setState({ cfg: 4 });
    w.gestures.end();
    expect(w.steps()[1].patches[0]).toMatchObject({ before: { cfg: 5 }, after: { cfg: 4 } });
  });

  it("records a landing as one step made from the wait's view", () => {
    const w = world();
    w.setView("gallery");
    w.recorder.landing("images", { kind: "restore" }, () => {
      w.settings.setState({ steps: 40 });
      w.inputs.setState({ frames: [{ id: "a", v: 1 }] });
    });
    expect(w.drafts).toHaveLength(1);
    expect(w.steps()[0]).toMatchObject({
      scope: "images",
      view: "images",
      name: { kind: "restore" },
    });
    expect(w.steps()[0].patches.map((p) => p.slice)).toEqual(["settings", "inputs"]);
    expect(w.settles).toEqual([]);
  });

  it("records `recorded` writes outside a gesture in the scope's own view", () => {
    const w = world();
    w.setView("video");
    w.recorder.recorded(() => w.settings.setState({ steps: 31 }));
    w.recorder.recorded(() => w.presets.setState({ presets: ["p"] }));
    w.recorder.recorded(() => w.settings.setState({ steps: 32 }), "gallery", { kind: "burst" });
    expect(w.steps().map((s) => [s.scope, s.view, s.name.kind])).toEqual([
      ["images", "images", "set"],
      ["shared", "video", "set"],
      ["images", "gallery", "burst"],
    ]);
  });

  it("closes the gesture's step before `recorded` runs inside it", () => {
    const w = world();
    w.gestures.start();
    w.settings.setState({ steps: 30 });
    w.recorder.recorded(() => w.settings.setState({ steps: 35 }));
    w.settings.setState({ cfg: 1 });
    w.gestures.end();
    expect(w.steps().map((s) => s.patches[0])).toEqual([
      expect.objectContaining({ after: { steps: 30 } }),
      expect.objectContaining({ after: { steps: 35 } }),
      expect.objectContaining({ after: { cfg: 1 } }),
    ]);
  });

  it("never records an ignored write, and later steps start from it", () => {
    const w = world();
    w.recorder.ignore("test", () => w.settings.setState({ steps: 25 }));
    w.gestures.start();
    w.settings.setState({ steps: 26 });
    w.gestures.end();
    expect(w.steps()).toHaveLength(1);
    expect(w.steps()[0].patches[0]).toMatchObject({ before: { steps: 25 }, after: { steps: 26 } });
    expect(w.settles).toEqual([]);
  });

  it("closes the pending step before an ignore inside a gesture", () => {
    const w = world();
    w.gestures.start();
    w.settings.setState({ steps: 30 });
    w.recorder.ignore("test", () => w.settings.setState({ cfg: 2 }));
    w.gestures.end();
    expect(w.steps()).toHaveLength(1);
    expect(w.steps()[0].patches[0]).toMatchObject({ before: { steps: 20 }, after: { steps: 30 } });
  });

  it("reports a checked key written by no step", () => {
    const w = world();
    w.recorder.ignore("test", () => w.model.setState({ activeModel: "B" }));
    w.model.setState({ activeModel: "C" });
    expect(w.touched).toEqual([["model\u0000activeModel"], ["model\u0000activeModel"]]);
  });

  it("makes a follow-up write part of the gesture's step", () => {
    const w = world();
    w.gestures.start();
    w.inputs.setState({ frames: [{ id: "a", v: 1 }] });
    w.recorder.follow("bake", () => w.inputs.setState({ frames: [{ id: "a", v: 2 }] }));
    w.gestures.end();
    expect(w.steps()).toHaveLength(1);
    expect(w.steps()[0].patches[0]).toMatchObject({
      items: { a: { before: { id: "a", v: 0 }, after: { id: "a", v: 2 } } },
    });
    expect(w.joins).toEqual([]);
  });

  it("joins a follow-up write outside a step by item, and settles keys silently", () => {
    const w = world();
    const first = w.inputs.getState().frames[0];
    w.recorder.follow("bake", () => {
      w.inputs.setState({ frames: [{ id: "a", v: 5 }], sizeSource: "x" });
      w.settings.setState({ steps: 22 });
    });
    expect(w.drafts).toEqual([]);
    expect(w.settles).toEqual([]);
    expect(w.joins).toEqual([
      {
        scope: "images",
        slice: "inputs",
        moves: [{ id: "a", from: first, to: { id: "a", v: 5 } }],
      },
    ]);
    w.gestures.start();
    w.settings.setState({ steps: 23 });
    w.gestures.end();
    expect(w.steps()[0].patches[0]).toMatchObject({ before: { steps: 22 } });
  });

  it("is deaf to a store while it rehydrates, once however often it is told", () => {
    const w = world();
    w.recorder.deafen(w.settings, true);
    w.recorder.deafen(w.settings, true);
    w.gestures.start();
    w.settings.setState({ steps: 99 });
    w.gestures.end();
    w.recorder.deafen(w.settings, false);
    expect(w.drafts).toEqual([]);
    expect(w.settles).toEqual([]);
    w.gestures.start();
    w.settings.setState({ steps: 100 });
    w.gestures.end();
    expect(w.steps()[0].patches[0]).toMatchObject({ before: { steps: 99 }, after: { steps: 100 } });
  });

  it("splits a step by scope, in scope order, with shared last", () => {
    const w = world();
    w.gestures.start();
    w.files.setState({ trashed: ["f"] });
    w.presets.setState({ presets: ["p"] });
    w.settings.setState({ steps: 30 });
    w.gestures.end();
    expect(w.drafts).toHaveLength(1);
    expect(w.drafts[0].map((d) => d.scope)).toEqual(["images", "gallery", "shared"]);
  });

  it("lets a model pick ride on the one document step it was made with", () => {
    const w = world();
    w.gestures.start();
    w.model.setState({ activeModel: "B" });
    w.settings.setState({ steps: 30 });
    w.gestures.end();
    const [step] = w.steps();
    expect(step.scope).toBe("images");
    expect(step.riders).toEqual([
      { slice: "model", kind: "keys", before: { activeModel: "A" }, after: { activeModel: "B" } },
    ]);
  });

  it("makes a model pick a shared step when no document or two changed", () => {
    const w = world();
    w.gestures.start();
    w.model.setState({ activeModel: "B" });
    w.gestures.end();
    w.gestures.start();
    w.model.setState({ activeModel: "C" });
    w.settings.setState({ steps: 30 });
    w.files.setState({ trashed: ["f"] });
    w.gestures.end();
    expect(w.drafts[0].map((d) => [d.scope, d.patches.length, d.riders.length])).toEqual([
      ["shared", 1, 0],
    ]);
    expect(w.drafts[1].map((d) => [d.scope, d.riders.length])).toEqual([
      ["images", 0],
      ["gallery", 0],
      ["shared", 0],
    ]);
    expect(w.drafts[1][2].patches[0].slice).toBe("model");
  });

  it("names a step by its title, else its first loud note, else its diff", () => {
    const w = world();
    w.gestures.start();
    w.recorder.note("images", { kind: "refit" }, true);
    w.recorder.note("images", { kind: "stroke", args: { frame: "a" } });
    w.inputs.setState({ frames: [{ id: "a", v: 1 }] });
    w.gestures.end();
    w.gestures.start();
    w.recorder.title({ kind: "preset" });
    w.recorder.note("images", { kind: "stroke" });
    w.settings.setState({ steps: 1 });
    w.gestures.end();
    w.gestures.start();
    w.recorder.note("images", { kind: "refit" }, true);
    w.settings.setState({ steps: 2 });
    w.gestures.end();
    expect(w.steps().map((s) => s.name)).toEqual([
      { kind: "stroke", args: { frame: "a" } },
      { kind: "preset" },
      { kind: "set", args: { slice: "settings", key: "steps" } },
    ]);
  });

  it("drops the notes of a task that recorded nothing", () => {
    const w = world();
    w.gestures.start();
    w.recorder.note("images", { kind: "stroke" });
    w.gestures.end();
    w.gestures.start();
    w.settings.setState({ steps: 1 });
    w.gestures.end();
    expect(w.steps()[0].name).toEqual({ kind: "set", args: { slice: "settings", key: "steps" } });
  });

  it("carries the selection from before and after the step", () => {
    const w = world();
    w.inputs.setState({ selected: "b" });
    w.gestures.start();
    w.inputs.setState({
      frames: [
        { id: "a", v: 0 },
        { id: "c", v: 0 },
      ],
      selected: "c",
    });
    w.gestures.end();
    expect(w.settles).toEqual([]);
    expect(w.steps()[0].context).toEqual({ before: "b", after: "c" });
  });

  it("gives a gesture's step its text tag, and no tag to a landing", () => {
    const w = world();
    const tag = {};
    w.gestures.start(tag);
    w.settings.setState({ steps: 30 });
    w.gestures.end();
    w.gestures.start(tag);
    w.recorder.landing("images", { kind: "drop" }, () => w.settings.setState({ steps: 31 }));
    w.gestures.end();
    expect(w.steps().map((s) => s.tag)).toEqual([tag, null]);
  });

  it("records nothing while replaying, and ends the gesture", () => {
    const w = world();
    const end = vi.spyOn(w.gestures, "end");
    w.gestures.start();
    w.recorder.replaying(() => {
      w.settings.setState({ steps: 5 });
      w.inputs.setState({ frames: [] });
    });
    expect(end).toHaveBeenCalled();
    expect(w.gestures.open()).toBe(false);
    w.settings.setState({ cfg: 1 });
    expect(w.drafts).toEqual([]);
    expect(w.settles.map((s) => s.slice)).toEqual(["settings"]);
  });

  it("records a command attached with no patch as a step of its own", () => {
    const w = world();
    const command = { undo: () => {}, redo: () => {}, tags: ["g"] };
    w.gestures.start();
    w.recorder.attach("gallery", command);
    w.gestures.end();
    w.gestures.start();
    w.recorder.attach("gallery", command);
    w.files.setState({ trashed: ["x"] });
    w.gestures.end();
    expect(w.steps().map((s) => [s.scope, s.name.kind, s.patches.length, s.commands])).toEqual([
      ["gallery", "command", 0, [command]],
      ["gallery", "set", 1, [command]],
    ]);
  });
  it("closes the step before a write that arrives once its event is over", () => {
    const w = world();
    w.gestures.start();
    w.settings.setState({ steps: 30 });
    w.gestures.leave();
    // another task, before the gesture has ended: the same slice and another
    w.settings.setState({ steps: 40 });
    w.files.setState({ trashed: ["late"] });
    w.gestures.end();
    expect(w.drafts).toHaveLength(1);
    expect(w.steps()[0].patches).toEqual([
      { slice: "settings", kind: "keys", before: { steps: 20 }, after: { steps: 30 } },
    ]);
    expect(w.settles.map((s) => [s.slice, s.patch])).toEqual([
      [
        "settings",
        { slice: "settings", kind: "keys", before: { steps: 30 }, after: { steps: 40 } },
      ],
      [
        "files",
        { slice: "files", kind: "keys", before: { trashed: [] }, after: { trashed: ["late"] } },
      ],
    ]);
  });

  it("keeps a late write's note with that write, not with the step before it", () => {
    const w = world();
    w.gestures.start();
    w.settings.setState({ steps: 30 });
    w.gestures.leave();
    w.recorder.note("images", { kind: "late" });
    w.settings.setState({ cfg: 5 });
    expect(w.steps()[0].name).toEqual({ kind: "set", args: { slice: "settings", key: "steps" } });
    expect(w.settles[0].notes).toEqual([{ kind: "late" }]);
  });

  it("joins a follow-up write that arrives once the step's event is over", () => {
    const w = world();
    w.gestures.start();
    w.inputs.setState({ frames: [{ id: "a", v: 1 }] });
    const stroked = w.inputs.getState().frames[0];
    w.gestures.leave();
    w.recorder.follow("bake", () => w.inputs.setState({ frames: [{ id: "a", v: 2 }] }));
    expect(w.steps()).toHaveLength(1);
    expect(w.steps()[0].patches[0]).toMatchObject({ items: { a: { after: stroked } } });
    expect(w.joins).toEqual([
      {
        scope: "images",
        slice: "inputs",
        moves: [{ id: "a", from: stroked, to: { id: "a", v: 2 } }],
      },
    ]);
  });

  it("opens no step for a follow-up write when none is pending, even in a gesture", () => {
    const w = world();
    const first = w.inputs.getState().frames[0];
    w.gestures.start();
    w.recorder.follow("bake", () => w.inputs.setState({ frames: [{ id: "a", v: 3 }] }));
    w.gestures.end();
    expect(w.drafts).toEqual([]);
    expect(w.joins).toHaveLength(1);
    expect(w.joins[0].moves[0]).toMatchObject({ id: "a", from: first });
  });

  it("leaves the model alone when a replay sets off an ignored write", () => {
    const w = world();
    w.recorder.replaying(() => {
      w.model.setState({ activeModel: "B" });
      w.recorder.ignore("hash accepted", () => w.settings.setState({ cfg: 1 }));
    });
    expect(w.touched).toEqual([]);
    expect(w.drafts).toEqual([]);
    // both writes are in the snapshot the replay left
    w.gestures.start();
    w.settings.setState({ cfg: 2 });
    w.gestures.end();
    expect(w.steps()[0].patches[0]).toMatchObject({ before: { cfg: 1 }, after: { cfg: 2 } });
    expect(w.steps()[0].riders).toEqual([]);
  });

  it("gives a command with no patch the view it was made from", () => {
    const w = world();
    const command = { undo: () => {}, redo: () => {}, tags: ["g"] };
    w.setView("images");
    w.gestures.start();
    w.recorder.attach("gallery", command);
    w.setView("video");
    w.gestures.end();
    expect(w.steps()[0]).toMatchObject({ scope: "gallery", view: "images", commands: [command] });
  });

  it("keeps what a step holds when a store that was not deaf is told to hear", () => {
    const w = world();
    w.gestures.start();
    w.settings.setState({ steps: 30 });
    w.recorder.deafen(w.settings, false);
    w.gestures.end();
    expect(w.steps()[0].patches[0]).toMatchObject({ before: { steps: 20 }, after: { steps: 30 } });
  });

  /** A recorder over an event no listener reported: found when first asked. */
  function unreported() {
    const tracker = createGestures(() => {});
    const event = { eventPhase: 2 };
    const settings = createStore(() => ({ steps: 20 }));
    const drafts: Draft[] = [];
    const recorder = createRecorder({
      gestures: { ...tracker, open: () => tracker.open() || tracker.adopt(event) },
      sink: { record: (d) => drafts.push(...d), touch: () => {}, join: () => {} },
      view: () => "images",
      now: () => 1,
    });
    recorder.add(
      keySlice({
        name: "settings",
        scope: "images",
        store: settings,
        keys: ["steps"],
        set: (v) => settings.setState(v),
      }),
    );
    const finish = () => {
      event.eventPhase = 0;
      tracker.end();
      return drafts.map((s) => [s.name.kind, s.patches.length, s.commands.length]);
    };
    return { recorder, settings, finish };
  }

  it("keeps a title given before the gesture is noticed", () => {
    const w = unreported();
    w.recorder.title({ kind: "preset" });
    w.settings.setState({ steps: 30 });
    expect(w.finish()).toEqual([["preset", 1, 0]]);
  });

  it("keeps a command given before the gesture is noticed with its step", () => {
    const w = unreported();
    w.recorder.attach("images", { undo: () => {}, redo: () => {}, tags: [] });
    w.settings.setState({ steps: 30 });
    expect(w.finish()).toEqual([["set", 1, 1]]);
  });

  it("gives a step whose event is over neither a later title nor a later command", () => {
    const w = world();
    const command = { undo: () => {}, redo: () => {}, tags: ["g"] };
    w.gestures.start();
    w.settings.setState({ steps: 30 });
    w.gestures.leave();
    w.recorder.title({ kind: "late" });
    w.recorder.attach("images", command);
    w.gestures.end();
    expect(w.steps().map((s) => [s.name.kind, s.patches.length, s.commands.length])).toEqual([
      ["set", 1, 0],
      ["late", 0, 1],
    ]);
  });

  it("records a command attached outside any step at once", () => {
    const w = world();
    const command = { undo: () => {}, redo: () => {}, tags: ["g"] };
    w.setView("gallery");
    w.recorder.attach("gallery", command);
    expect(w.steps()).toMatchObject([{ scope: "gallery", view: "gallery", commands: [command] }]);
  });

  it("lets go of a command attached while a replay or an ignored write runs", () => {
    const w = world();
    const dispose = vi.fn();
    const command = { undo: () => {}, redo: () => {}, tags: ["g"], dispose };
    w.recorder.replaying(() => w.recorder.attach("gallery", command));
    w.recorder.ignore("test", () => w.recorder.attach("gallery", command));
    w.gestures.start();
    w.gestures.end();
    expect(w.steps()).toEqual([]);
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
