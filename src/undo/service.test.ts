import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { NavView } from "@/lib/constants";
import { openTyping, type TypingKind } from "@/lib/undo/stacks";
import type { Command, Scope } from "@/lib/undo/types";
import { drivenGestures } from "./gesture";
import { NO_HOOKS } from "./replay";
import {
  createUndo,
  type EditorHandle,
  type Notices,
  type Undo,
  type UndoOptions,
} from "./service";
import { keySlice, listSlice } from "./slice";

const RECORDED: ReadonlySet<Scope> = new Set<Scope>(["images", "gallery", "shared"]);

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function world(overrides: Partial<UndoOptions> = {}) {
  const settings = createStore(() => ({ steps: 20, cfg: 7 }));
  const model = createStore(() => ({ activeModel: "A" }));
  const gestures = drivenGestures();
  let view: NavView = "images";
  const undo = createUndo({
    gestures,
    view: () => view,
    recorded: RECORDED,
    hooks: NO_HOOKS,
    holdMs: 1000,
    ...overrides,
  });
  undo.add(
    keySlice({
      name: "settings",
      scope: "images",
      store: settings,
      keys: ["steps", "cfg"],
      set: (v) => settings.setState(v),
    }),
  );
  undo.add(
    keySlice({
      name: "model",
      scope: "shared",
      store: model,
      keys: ["activeModel"],
      checked: ["activeModel"],
      set: (v) => model.setState(v),
    }),
  );
  const act = (fn: () => void) => {
    gestures.start();
    fn();
    gestures.end();
  };
  const sides = (scope: Scope) => {
    const stack = undo.stacks().byScope[scope];
    return { undo: stack.undo.map((s) => s.id), redo: stack.redo.map((s) => s.id) };
  };
  return {
    settings,
    model,
    gestures,
    undo,
    act,
    sides,
    setView: (next: NavView) => {
      view = next;
    },
  };
}

const command = (overrides: Partial<Command> = {}): Command => ({
  undo: () => {},
  redo: () => {},
  tags: [],
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("undo service", () => {
  it("undoes and redoes a step", async () => {
    const w = world();
    w.act(() => w.settings.setState({ steps: 30 }));
    expect(w.undo.next("undo").kind).toBe("replay");
    const undone = await w.undo.press("undo");
    expect(undone).toMatchObject({ kind: "replayed", side: "before" });
    expect(w.settings.getState().steps).toBe(20);
    await w.undo.press("redo");
    expect(w.settings.getState().steps).toBe(30);
    expect(await w.undo.press("redo")).toEqual({ kind: "none" });
  });

  it("records nothing a replay sets off", async () => {
    const w = world();
    // an effect that re-asserts an invariant: cfg follows steps
    w.settings.subscribe((s) => {
      if (s.steps === 20 && s.cfg !== 1) w.settings.setState({ cfg: 1 });
    });
    w.act(() => w.settings.setState({ steps: 30 }));
    await w.undo.press("undo");
    expect(w.settings.getState()).toMatchObject({ steps: 20, cfg: 1 });
    expect(w.sides("images")).toEqual({ undo: [], redo: [1] });
    // redo stays reachable: nothing the replay set off cleared it
    await w.undo.press("redo");
    expect(w.settings.getState().steps).toBe(30);
  });

  it("leaves a step where it was when a guard refuses", async () => {
    const w = world();
    w.undo.marks.command(
      "gallery",
      { kind: "trash" },
      command({
        guard: () => Promise.reject(new Error("full")),
      }),
    );
    const outcome = await w.undo.press("undo");
    expect(outcome).toMatchObject({ kind: "refused" });
    expect(w.sides("gallery")).toEqual({ undo: [1], redo: [] });
  });

  it("drops a press whose step moved during its guards, and takes the guard's write back", async () => {
    const w = world();
    const gate = deferred();
    const revert = vi.fn();
    const undo = vi.fn();
    w.undo.marks.command(
      "gallery",
      { kind: "trash" },
      command({
        guard: async () => {
          await gate.promise;
          return revert;
        },
        undo,
      }),
    );
    const pressed = w.undo.press("undo");
    await Promise.resolve();
    w.act(() => w.settings.setState({ steps: 30 }));
    gate.resolve();
    expect(await pressed).toEqual({ kind: "stale" });
    expect(revert).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();
    expect(w.sides("gallery")).toEqual({ undo: [1], redo: [] });
  });

  it("keeps a step recorded while a command runs as an ordinary step", async () => {
    const w = world();
    const gate = deferred();
    w.undo.marks.command("gallery", { kind: "trash" }, command({ undo: () => gate.promise }));
    const pressed = w.undo.press("undo");
    await vi.waitFor(() => expect(w.sides("gallery").redo).toEqual([1]));
    w.act(() => w.settings.setState({ steps: 30 }));
    gate.resolve();
    await pressed;
    expect(w.sides("gallery")).toEqual({ undo: [], redo: [1] });
    expect(w.sides("images").undo).toHaveLength(1);
    await w.undo.press("undo");
    expect(w.settings.getState().steps).toBe(20);
  });

  it("drops a step with no patch when its command fails", async () => {
    const w = world();
    w.undo.marks.command(
      "gallery",
      { kind: "trash" },
      command({
        undo: () => {
          throw new Error("gone");
        },
      }),
    );
    const outcome = await w.undo.press("undo");
    expect(outcome).toMatchObject({ kind: "replayed", failed: { dropped: true } });
    expect(w.sides("gallery")).toEqual({ undo: [], redo: [] });
  });

  it("keeps the move of a step with patches when its command fails", async () => {
    const w = world();
    w.act(() => {
      w.undo.marks.attach(
        "images",
        command({
          undo: () => Promise.reject(new Error("refused")),
        }),
      );
      w.settings.setState({ steps: 30 });
    });
    const outcome = await w.undo.press("undo");
    expect(outcome).toMatchObject({ kind: "replayed", failed: { dropped: false } });
    expect(w.settings.getState().steps).toBe(20);
    expect(w.sides("images").redo).toHaveLength(1);
  });

  it("runs commands in reverse on undo and in order on redo", async () => {
    const w = world();
    const calls: string[] = [];
    w.act(() => {
      w.undo.marks.attach(
        "images",
        command({ undo: () => void calls.push("u1"), redo: () => void calls.push("r1") }),
      );
      w.undo.marks.attach(
        "images",
        command({ undo: () => void calls.push("u2"), redo: () => void calls.push("r2") }),
      );
      w.settings.setState({ steps: 30 });
    });
    await w.undo.press("undo");
    await w.undo.press("redo");
    expect(calls).toEqual(["u2", "u1", "r1", "r2"]);
  });

  it("commits a held step once it is due", async () => {
    vi.useFakeTimers();
    const w = world();
    const commit = vi.fn();
    const undo = vi.fn();
    w.undo.marks.hold("shared", { kind: "delete job" }, { undo, commit });
    await vi.advanceTimersByTimeAsync(999);
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(commit).toHaveBeenCalledOnce();
    expect(w.sides("shared").undo).toEqual([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(commit).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();
  });

  it("releases a held step on Undo, and never commits it after", async () => {
    vi.useFakeTimers();
    const w = world();
    const commit = vi.fn();
    const undo = vi.fn();
    w.undo.marks.hold("shared", { kind: "delete job" }, { undo, commit });
    expect(await w.undo.press("undo")).toMatchObject({ kind: "released" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(undo).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it("releases a held step from its notice out of order", async () => {
    vi.useFakeTimers();
    const w = world();
    const first = { undo: vi.fn(), commit: vi.fn() };
    const second = { undo: vi.fn(), commit: vi.fn() };
    w.undo.marks.hold("shared", { kind: "delete job" }, first);
    w.undo.marks.hold("shared", { kind: "delete job" }, second);
    w.undo.release(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(first.undo).toHaveBeenCalledOnce();
    expect(first.commit).not.toHaveBeenCalled();
    expect(second.commit).toHaveBeenCalledOnce();
  });

  it("waits for a running press before it commits a held step", async () => {
    vi.useFakeTimers();
    const w = world();
    const gate = deferred();
    const commit = vi.fn();
    w.undo.marks.hold("shared", { kind: "delete job" }, { undo: () => {}, commit });
    w.act(() => w.undo.marks.attach("images", command({ undo: () => gate.promise })));
    w.act(() => {
      w.undo.marks.attach("images", command({ undo: () => gate.promise }));
      w.settings.setState({ steps: 30 });
    });
    const pressed = w.undo.press("undo");
    await vi.advanceTimersByTimeAsync(2000);
    expect(commit).not.toHaveBeenCalled();
    expect(w.undo.busy()).toBe(true);
    gate.resolve();
    await pressed;
    await vi.advanceTimersByTimeAsync(0);
    expect(commit).toHaveBeenCalledOnce();
    expect(w.undo.busy()).toBe(false);
  });

  it("commits a held step that is cleared", () => {
    const w = world();
    const commit = vi.fn();
    w.undo.marks.hold("shared", { kind: "delete job" }, { undo: () => {}, commit });
    w.undo.marks.clear("shared");
    expect(commit).toHaveBeenCalledOnce();
  });

  it("lets every dropped step go when one of them throws", () => {
    const w = world();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const commit = vi.fn();
    w.undo.marks.hold(
      "shared",
      { kind: "delete job" },
      {
        undo: () => {},
        commit: () => {
          throw new Error("refused");
        },
      },
    );
    w.undo.marks.hold("shared", { kind: "delete job" }, { undo: () => {}, commit });
    expect(() => w.undo.marks.clear("shared")).not.toThrow();
    expect(commit).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledOnce();
    expect(w.sides("shared")).toEqual({ undo: [], redo: [] });
    logged.mockRestore();
  });

  it("cancels the newest wait before an older step, and a cancelled wait does not land", async () => {
    const w = world();
    w.act(() => w.settings.setState({ steps: 30 }));
    const wait = w.undo.marks.wait("images", { kind: "drop" });
    expect(w.undo.next("undo")).toMatchObject({ kind: "cancel" });
    expect(await w.undo.press("undo")).toMatchObject({ kind: "cancelled" });
    expect(wait.cancelled).toBe(true);
    const land = vi.fn();
    expect(wait.land(land)).toBe(false);
    expect(land).not.toHaveBeenCalled();
    expect(w.settings.getState().steps).toBe(30);
  });

  it("lands a wait as one step made from the view it began in", () => {
    const w = world();
    const wait = w.undo.marks.wait("images", { kind: "restore" });
    w.setView("gallery");
    expect(wait.land(() => w.settings.setState({ steps: 40, cfg: 2 }))).toBe(true);
    const [step] = w.undo.stacks().byScope.images.undo;
    expect(step).toMatchObject({ view: "images", name: { kind: "restore" } });
    expect(w.undo.waits()).toEqual([]);
  });

  it("cancels a wait that replaces the list when another step lands in its scope", () => {
    const w = world();
    const replacing = w.undo.marks.wait("images", { kind: "restore" }, { replaces: true });
    const adding = w.undo.marks.wait("images", { kind: "drop" });
    w.act(() => w.settings.setState({ steps: 30 }));
    expect(replacing.cancelled).toBe(true);
    expect(adding.cancelled).toBe(false);
  });

  it("cancels a replacing wait when a held step or a command lands in its scope", () => {
    const w = world();
    const first = w.undo.marks.wait("shared", { kind: "restore" }, { replaces: true });
    w.undo.marks.hold("shared", { kind: "delete job" }, { undo: () => {}, commit: () => {} });
    expect(first.cancelled).toBe(true);
    const second = w.undo.marks.wait("shared", { kind: "restore" }, { replaces: true });
    w.undo.marks.command("shared", { kind: "trash" }, command());
    expect(second.cancelled).toBe(true);
  });

  it("cancels a scope's waits when it is cleared", () => {
    const w = world();
    const wait = w.undo.marks.wait("images", { kind: "drop" });
    w.act(() => w.settings.setState({ steps: 30 }));
    w.undo.marks.clear("images");
    expect(wait.cancelled).toBe(true);
    expect(w.sides("images")).toEqual({ undo: [], redo: [] });
  });

  it("survives a cut and a clear between the ticks of a press", async () => {
    const w = world();
    const gate = deferred();
    w.undo.marks.command("gallery", { kind: "trash" }, command({ undo: () => gate.promise }));
    w.act(() => w.settings.setState({ steps: 30 }));
    w.undo.marks.command("gallery", { kind: "trash" }, command({ undo: () => gate.promise }));
    const pressed = w.undo.press("undo");
    await vi.waitFor(() => expect(w.sides("gallery").redo).toHaveLength(1));
    w.undo.marks.clear("gallery");
    w.undo.marks.clear("images");
    gate.resolve();
    expect(await pressed).toMatchObject({ kind: "replayed" });
    expect(await w.undo.press("undo")).toEqual({ kind: "none" });
  });

  it("gives a model pick up once a write no step made moved it", async () => {
    const w = world();
    w.act(() => w.model.setState({ activeModel: "B" }));
    w.undo.marks.ignore("model sync", () => w.model.setState({ activeModel: "C" }));
    expect(await w.undo.press("undo")).toEqual({ kind: "none" });
    expect(w.model.getState().activeModel).toBe("C");
    expect(w.sides("shared")).toEqual({ undo: [], redo: [] });
  });

  it("clears a store's scope when it has read itself from storage", () => {
    const w = world();
    w.act(() => w.settings.setState({ steps: 30 }));
    w.undo.marks.rehydrating(w.settings, true);
    w.settings.setState({ steps: 50 });
    w.undo.marks.rehydrating(w.settings, false);
    expect(w.sides("images")).toEqual({ undo: [], redo: [] });
    w.act(() => w.settings.setState({ steps: 51 }));
    expect(w.undo.stacks().byScope.images.undo[0].patches[0]).toMatchObject({
      before: { steps: 50 },
    });
  });

  it("evicts the oldest steps naming bytes over the budget, never a top", () => {
    const pictures = createStore(() => ({ picture: null as { cid: string } | null }));
    const w = world({ byteBudget: 150 });
    const slice = keySlice({
      name: "pictures",
      scope: "images",
      store: pictures,
      keys: ["picture"],
      set: (v) => pictures.setState(v),
    });
    w.undo.add({
      ...slice,
      cids: (patch) =>
        patch.kind === "keys"
          ? [patch.before["picture"], patch.after["picture"]].flatMap((p) =>
              p ? [[(p as { cid: string }).cid, 100] as const] : [],
            )
          : [],
      named: () => {
        const p = pictures.getState().picture;
        return p ? [p.cid] : [];
      },
    });
    for (const cid of ["a", "b", "c"]) w.act(() => pictures.setState({ picture: { cid } }));
    const kept = w.undo.stacks().byScope.images.undo;
    expect(kept.map((s) => [...s.cids.keys()])).toEqual([["b", "c"]]);
    expect(w.undo.holds()).toEqual(new Set(["b", "c"]));
  });

  it("keeps every undo side in id order whatever order commands finish in", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.array(fc.constantFrom("write", "command", "undo", "redo", "hold", "clear"), {
          minLength: 1,
          maxLength: 25,
        }),
        async (s, ops) => {
          const w = world({ holdMs: 0 });
          const commits = new Map<number, number>();
          const releases = new Set<number>();
          let value = 0;
          let n = 0;
          const presses: Promise<unknown>[] = [];
          for (const op of ops) {
            if (op === "write") w.act(() => w.settings.setState({ steps: ++value }));
            if (op === "command") {
              w.undo.marks.command(
                "gallery",
                { kind: "trash" },
                command({
                  undo: () => s.schedule(Promise.resolve()),
                  redo: () => s.schedule(Promise.resolve()),
                }),
              );
            }
            if (op === "hold") {
              const id = ++n;
              w.undo.marks.hold(
                "shared",
                { kind: "delete job" },
                {
                  undo: () => releases.add(id),
                  commit: () => {
                    commits.set(id, (commits.get(id) ?? 0) + 1);
                    expect(releases.has(id)).toBe(false);
                  },
                },
              );
            }
            if (op === "clear") w.undo.marks.clear("gallery");
            if (op === "undo" || op === "redo") presses.push(w.undo.press(op));
            if (s.count() > 0) await s.waitOne();
          }
          await s.waitFor(Promise.all(presses));
          for (const scope of ["images", "gallery", "shared"] as const) {
            const ids = w.undo.stacks().byScope[scope].undo.map((step) => step.id);
            expect(ids).toEqual([...ids].sort((a, b) => a - b));
          }
          for (const count of commits.values()) expect(count).toBe(1);
          w.undo.stop();
        },
      ),
    );
  });
});

/** Notices that record what they were told. */
function notices() {
  return {
    doing: vi.fn<Notices["doing"]>(),
    progress: vi.fn<Notices["progress"]>(),
    pressed: vi.fn<Notices["pressed"]>(),
  };
}

/** A world whose images scope also holds pictures named by content id. */
function withPictures() {
  const w = world();
  const pictures = createStore(() => ({ items: [] as { id: string; cid: string }[] }));
  const cidOf = (value: unknown) => (value as { cid?: string } | null)?.cid;
  w.undo.add(
    listSlice({
      name: "pictures",
      scope: "images",
      store: pictures,
      items: (s) => s.items,
      idOf: (p) => p.id,
      keys: [],
      set: (next) => pictures.setState({ items: [...next.items] }),
      cids: (patch) =>
        patch.kind === "list"
          ? Object.values(patch.items).flatMap((c) =>
              [cidOf(c.before), cidOf(c.after)].flatMap((cid) => (cid ? [[cid, 10] as const] : [])),
            )
          : [],
      named: () => pictures.getState().items.map((p) => p.cid),
    }),
  );
  return { ...w, pictures };
}

describe("undo service: names, notices and cuts", () => {
  it("names a landing by a title made inside it, else by its wait", () => {
    const w = world();
    w.undo.marks.wait("images", { kind: "add pictures", args: { count: 3 } }).land(() => {
      w.undo.marks.title({ kind: "add pictures", args: { count: 2 } });
      w.settings.setState({ steps: 31 });
    });
    w.undo.marks.wait("images", { kind: "restore" }).land(() => w.settings.setState({ steps: 32 }));
    expect(w.undo.stacks().byScope.images.undo.map((s) => s.name)).toEqual([
      { kind: "add pictures", args: { count: 2 } },
      { kind: "restore" },
    ]);
  });

  it("aborts a cancelled wait's signal and says the wait's name", async () => {
    const w = world();
    const wait = w.undo.marks.wait("images", { kind: "recall", args: { name: "Set" } });
    const [open] = w.undo.waits();
    expect(w.undo.waitName(open.id)).toEqual({ kind: "recall", args: { name: "Set" } });
    expect(wait.signal.aborted).toBe(false);
    expect(await w.undo.press("undo")).toMatchObject({
      kind: "cancelled",
      name: { kind: "recall" },
    });
    expect(wait.signal.aborted).toBe(true);
    expect(w.undo.waitName(open.id)).toBeNull();
  });

  it("cancels a wait from its own notice, out of order", () => {
    const w = world();
    const older = w.undo.marks.wait("images", { kind: "drop" });
    const newer = w.undo.marks.wait("images", { kind: "recall" });
    const [first] = w.undo.waits();
    w.undo.cancel(first.id);
    expect(older.cancelled).toBe(true);
    expect(newer.cancelled).toBe(false);
  });

  it("passes a wait's progress on at most once a second", () => {
    let time = 0;
    const told = notices();
    const w = world({ now: () => time, notices: told });
    const wait = w.undo.marks.wait("images", { kind: "recall" });
    wait.progress("1 of 3");
    time = 400;
    wait.progress("2 of 3");
    time = 1100;
    wait.progress("3 of 3");
    expect(told.progress.mock.calls.map((call) => call[2])).toEqual(["1 of 3", "3 of 3"]);
  });

  it("shows an announcement with the step its gesture made, and plainly without one", () => {
    const told = notices();
    const { doing } = told;
    const w = world({ notices: told });
    w.act(() => {
      w.settings.setState({ steps: 33 });
      w.undo.marks.announce("images").show("Changed");
    });
    expect(doing).toHaveBeenCalledTimes(1);
    expect(doing.mock.calls[0][0]).toMatchObject({ scope: "images" });
    expect(doing.mock.calls[0][1]).toBe("Changed");
    w.act(() => w.undo.marks.announce("images").show("Nothing changed"));
    expect(doing).toHaveBeenLastCalledWith(null, "Nothing changed", {});
  });

  it("shows a command's and a held step's notice with their steps", () => {
    const told = notices();
    const { doing } = told;
    const w = world({ notices: told });
    w.undo.marks.command("gallery", { kind: "files trashed" }, command()).show("Moved");
    w.undo.marks
      .hold("shared", { kind: "delete job" }, { undo: () => {}, commit: () => {} })
      .show("Deleted");
    expect(doing.mock.calls.map((call) => [call[0]?.name.kind, call[1]])).toEqual([
      ["files trashed", "Moved"],
      ["delete job", "Deleted"],
    ]);
    expect(typeof doing.mock.calls[1][0]?.held?.until).toBe("number");
  });

  it("tells the notices what each press did", async () => {
    const told = notices();
    const { pressed } = told;
    const w = world({ notices: told });
    w.act(() => w.settings.setState({ steps: 35 }));
    await w.undo.press("undo");
    await w.undo.press("undo");
    expect(pressed.mock.calls.map((call) => [call[0], call[1].kind])).toEqual([
      ["undo", "replayed"],
      ["undo", "none"],
    ]);
  });

  it("counts the steps a cut would take without taking them, then takes them", () => {
    const w = withPictures();
    w.act(() => w.pictures.setState({ items: [{ id: "p", cid: "c1" }] }));
    w.act(() => w.settings.setState({ steps: 34 }));
    expect(w.undo.cutSize(new Set(["c1"]))).toBe(1);
    expect(w.undo.holds()).toEqual(new Set(["c1"]));
    expect(w.sides("images").undo).toHaveLength(2);
    expect(w.undo.cut(new Set(["c1"]))).toBe(1);
    expect(w.sides("images").undo).toHaveLength(1);
    expect(w.undo.holds()).toEqual(new Set());
  });

  it("reads a command's tags when items go, so a moved item still drops its step", () => {
    const w = world();
    let tags = ["file:a"];
    w.undo.marks.command(
      "gallery",
      { kind: "files trashed" },
      {
        undo: () => {},
        redo: () => {},
        get tags() {
          return tags;
        },
      },
    );
    tags = ["file:b"];
    w.undo.invalidate(new Set(["file:a"]));
    expect(w.sides("gallery").undo).toHaveLength(1);
    w.undo.invalidate(new Set(["file:b"]));
    expect(w.sides("gallery").undo).toHaveLength(0);
  });
});

describe("a text field's typing", () => {
  it("is the history's once a step recorded it, and the field's own when none ever did", () => {
    const w = world();
    const recorded = {};
    const unrecorded = {};
    w.gestures.start({}, recorded);
    w.settings.setState({ steps: 30 });
    w.gestures.end();
    expect(w.undo.typedUnrecorded(recorded)).toBe(false);
    // typed, but nothing it wrote is recorded
    w.gestures.start({}, unrecorded);
    w.gestures.end();
    expect(w.undo.typedUnrecorded(unrecorded)).toBe(true);
    // never typed into
    expect(w.undo.typedUnrecorded({})).toBe(false);
  });

  it("stays the history's after its step leaves the stacks", async () => {
    const w = world();
    const field = {};
    w.gestures.start({}, field);
    w.settings.setState({ steps: 30 });
    w.gestures.end();
    await w.undo.press("undo");
    // a new step clears the redo side the typing went to
    w.act(() => w.settings.setState({ cfg: 5 }));
    expect(w.sides("images").redo).toEqual([]);
    expect(w.undo.typedUnrecorded(field)).toBe(false);
    w.undo.marks.rehydrating(w.settings, true);
    w.undo.marks.rehydrating(w.settings, false);
    expect(w.undo.typedUnrecorded(field)).toBe(false);
  });

  it("stays the history's after its session types back to where it began", () => {
    const w = world();
    const field = {};
    const session = {};
    w.gestures.start(session, field);
    w.settings.setState({ steps: 30 });
    w.gestures.end();
    w.gestures.start(session, field);
    w.settings.setState({ steps: 20 });
    w.gestures.end();
    expect(w.sides("images").undo).toEqual([]);
    expect(w.undo.typedUnrecorded(field)).toBe(false);
  });
});

type Prompts = { prompt: string; negative: string; steps: number };

/** A prompt editor over one key, its own history kept as CodeMirror keeps it:
 * one group per typed change, emptied by a write from the store. */
function promptEditor(
  history: Undo,
  store: StoreApi<Prompts>,
  key: "prompt" | "negative",
  gestures: ReturnType<typeof drivenGestures>,
) {
  let doc = store.getState()[key];
  let done: string[] = [];
  let undone: string[] = [];
  let readOnly = false;
  let resets = 0;
  const handle: EditorHandle = {
    undo: () => {
      const back = done.at(-1);
      if (readOnly || back === undefined) return false;
      done = done.slice(0, -1);
      undone = [...undone, doc];
      change("undo", back);
      return true;
    },
    redo: () => {
      const forward = undone.at(-1);
      if (readOnly || forward === undefined) return false;
      undone = undone.slice(0, -1);
      done = [...done, doc];
      change("redo", forward);
      return true;
    },
    undoDepth: () => done.length,
    redoDepth: () => undone.length,
    reset: () => {
      done = [];
      undone = [];
      resets += 1;
    },
    text: () => doc,
  };
  function change(kind: TypingKind, next: string) {
    const before = doc;
    doc = next;
    history.typing(handle, kind, before, () => store.setState({ [key]: next }));
  }
  store.subscribe((s) => {
    if (s[key] === doc) return;
    doc = s[key];
    done = [];
    undone = [];
  });
  return {
    handle,
    type: (next: string) => {
      gestures.start();
      done = [...done, doc];
      undone = [];
      change("input", next);
      gestures.end();
    },
    get text() {
      return doc;
    },
    get resets() {
      return resets;
    },
    setReadOnly: (on: boolean) => {
      readOnly = on;
    },
  };
}

function typingWorld() {
  const settings = createStore<Prompts>(() => ({ prompt: "", negative: "", steps: 20 }));
  const gestures = drivenGestures();
  const history = createUndo({
    gestures,
    view: () => "images",
    recorded: RECORDED,
    hooks: NO_HOOKS,
    holdMs: 1000,
  });
  history.add(
    keySlice({
      name: "settings",
      scope: "images",
      store: settings,
      keys: ["prompt", "negative", "steps"],
      set: (v) => settings.setState(v),
    }),
  );
  const stack = () => history.stacks().byScope.images;
  return {
    settings,
    history,
    editor: (key: "prompt" | "negative") => promptEditor(history, settings, key, gestures),
    act: (fn: () => void) => {
      gestures.start();
      fn();
      gestures.end();
    },
    sides: () => ({ undo: stack().undo.length, redo: stack().redo.length }),
    open: () => openTyping(history.stacks()),
  };
}

describe("typing in a prompt editor", () => {
  it("is one open run, which Undo steps back through the editor's own history", async () => {
    const w = typingWorld();
    const prompt = w.editor("prompt");
    prompt.type("a");
    prompt.type("ab");
    expect(w.sides()).toEqual({ undo: 1, redo: 0 });
    expect(w.open()?.name).toEqual({ kind: "typing", args: { slice: "settings", key: "prompt" } });
    expect(w.history.next("undo").kind).toBe("editor");
    expect(await w.history.press("undo")).toMatchObject({ kind: "typed" });
    expect(prompt.text).toBe("a");
    expect(w.settings.getState().prompt).toBe("a");
    await w.history.press("undo");
    expect(prompt.text).toBe("");
    // back where the run began, with nothing else in reach
    expect(await w.history.press("undo")).toEqual({ kind: "none" });
    expect(w.open()).not.toBeNull();
  });

  it("redoes inside the editor while the run is open", async () => {
    const w = typingWorld();
    const prompt = w.editor("prompt");
    prompt.type("a");
    prompt.type("ab");
    await w.history.press("undo");
    expect(w.history.next("redo").kind).toBe("editor");
    await w.history.press("redo");
    expect(prompt.text).toBe("ab");
    expect(w.settings.getState().prompt).toBe("ab");
  });

  it("closes when another step is recorded, and the editor's own history empties", async () => {
    const w = typingWorld();
    const prompt = w.editor("prompt");
    prompt.type("a");
    prompt.type("ab");
    w.act(() => w.settings.setState({ steps: 30 }));
    expect(w.open()).toBeNull();
    expect(prompt.resets).toBe(1);
    await w.history.press("undo");
    expect(w.settings.getState().steps).toBe(20);
    // the run as a whole
    expect(await w.history.press("undo")).toMatchObject({ kind: "replayed", side: "before" });
    expect(prompt.text).toBe("");
  });

  it("puts what the editor stepped back from on Redo when the editor hides", async () => {
    const w = typingWorld();
    const prompt = w.editor("prompt");
    prompt.type("a");
    prompt.type("ab");
    await w.history.press("undo");
    w.history.closeTyping(prompt.handle);
    expect(w.open()).toBeNull();
    expect(prompt.resets).toBe(1);
    expect(w.sides()).toEqual({ undo: 1, redo: 1 });
    await w.history.press("redo");
    expect(prompt.text).toBe("ab");
    await w.history.press("undo");
    await w.history.press("undo");
    expect(prompt.text).toBe("");
  });

  it("leaves no step for a run whose text came back to where it began", () => {
    const w = typingWorld();
    const prompt = w.editor("prompt");
    prompt.type("a");
    prompt.type("");
    w.history.closeTyping(prompt.handle);
    expect(w.sides()).toEqual({ undo: 0, redo: 0 });
  });

  it("undoes a read-only editor's run whole", async () => {
    const w = typingWorld();
    const prompt = w.editor("prompt");
    prompt.type("a");
    prompt.type("ab");
    prompt.setReadOnly(true);
    expect(await w.history.press("undo")).toMatchObject({ kind: "replayed", side: "before" });
    expect(prompt.text).toBe("");
    expect(w.sides()).toEqual({ undo: 0, redo: 1 });
  });

  it("closes one editor's run when another editor types, and only on that editor's hide", () => {
    const w = typingWorld();
    const prompt = w.editor("prompt");
    const negative = w.editor("negative");
    prompt.type("a");
    w.history.closeTyping(negative.handle);
    expect(w.open()?.typing?.editor).toBe(prompt.handle);
    negative.type("b");
    expect(prompt.resets).toBe(1);
    expect(w.sides()).toEqual({ undo: 2, redo: 0 });
    expect(w.open()?.typing?.editor).toBe(negative.handle);
  });

  it("keeps its run when the step that closes it writes back the text the run began from", async () => {
    const w = typingWorld();
    const prompt = w.editor("prompt");
    prompt.type("a");
    prompt.type("ab");
    // a restore made in a gesture: the editor shows its text before the step is recorded
    w.act(() => w.settings.setState({ prompt: "" }));
    expect(w.sides()).toEqual({ undo: 2, redo: 0 });
    await w.history.press("undo");
    expect(prompt.text).toBe("ab");
    await w.history.press("undo");
    expect(prompt.text).toBe("");
  });

  it("empties the editor's own history after a change no run holds", async () => {
    const w = typingWorld();
    const prompt = w.editor("prompt");
    // the store reads itself from storage: the change is no step's
    w.history.marks.rehydrating(w.settings, true);
    prompt.type("a");
    w.history.marks.rehydrating(w.settings, false);
    expect(w.sides()).toEqual({ undo: 0, redo: 0 });
    expect(prompt.resets).toBe(1);
    prompt.type("ab");
    await w.history.press("undo");
    expect(prompt.text).toBe("a");
    expect(await w.history.press("undo")).toEqual({ kind: "none" });
    expect(prompt.text).toBe("a");
  });

  it("does nothing on Redo when a read-only editor cannot redo what it stepped back from", async () => {
    const w = typingWorld();
    const prompt = w.editor("prompt");
    prompt.type("a");
    prompt.type("ab");
    await w.history.press("undo");
    prompt.setReadOnly(true);
    expect(await w.history.press("redo")).toEqual({ kind: "none" });
    expect(prompt.text).toBe("a");
    expect(w.settings.getState().prompt).toBe("a");
  });

  it("steps through the editor when a press names the open run", async () => {
    const w = typingWorld();
    const prompt = w.editor("prompt");
    prompt.type("a");
    prompt.type("ab");
    const only = w.open()?.id ?? -1;
    expect(await w.history.press("undo", { only })).toMatchObject({ kind: "typed" });
    expect(prompt.text).toBe("a");
    expect(await w.history.press("redo", { only })).toMatchObject({ kind: "typed" });
    expect(prompt.text).toBe("ab");
  });
});
