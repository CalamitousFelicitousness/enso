import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { NavView } from "@/lib/constants";
import type { Command, Scope } from "@/lib/undo/types";
import { drivenGestures } from "./gesture";
import { NO_HOOKS } from "./replay";
import { createUndo, type UndoOptions } from "./service";
import { keySlice } from "./slice";

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
