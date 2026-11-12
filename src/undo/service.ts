// The undo history at run time: the stacks, the press queue, waits and held
// steps. Generic over the slices it is given; the recorder it builds sends it
// every step.

import type { NavView } from "@/lib/constants";
import { BYTE_BUDGET, evict, STEP_LIMIT } from "@/lib/undo/budget";
import * as core from "@/lib/undo/stacks";
import type {
  Change,
  Command,
  Draft,
  Env,
  Facts,
  Patch,
  Scope,
  Side,
  Stacks,
  Step,
  StepName,
  Wait,
} from "@/lib/undo/types";
import type { Gestures } from "./gesture";
import type { HeldAction, Marks, WaitHandle, WaitOptions } from "./marks";
import { createRecorder, type Recorder, type RecorderLog } from "./recorder";
import { replay, type ReplayHooks } from "./replay";
import type { Slice } from "./slice";

export type PressKind = "undo" | "redo";

export type Outcome =
  | { readonly kind: "none" }
  | { readonly kind: "cancelled"; readonly wait: Wait }
  | { readonly kind: "released"; readonly step: Step }
  | {
      readonly kind: "replayed";
      readonly step: Step;
      readonly side: Side;
      /** Checked keys the step gave up. */
      readonly gaveUp: readonly string[];
      /** A command that threw, and whether the step went with it. */
      readonly failed: { readonly error: unknown; readonly dropped: boolean } | null;
    }
  /** A guard refused: the step stays where it was. */
  | { readonly kind: "refused"; readonly step: Step; readonly error: unknown }
  /** Something moved the step while its guards ran: nothing was done. */
  | { readonly kind: "stale" };

export interface UndoOptions {
  readonly gestures: Gestures;
  /** The view on screen. */
  readonly view: () => NavView;
  /** Scopes whose own document is recorded. */
  readonly recorded: ReadonlySet<Scope>;
  readonly hooks: ReplayHooks;
  readonly now?: () => number;
  readonly log?: RecorderLog;
  readonly stepLimit?: number;
  readonly byteBudget?: number;
  /** How long a held step waits before it commits. */
  readonly holdMs: number;
}

export interface Undo {
  readonly add: (slice: Slice) => void;
  /** The declarations, for `install`. */
  readonly marks: Marks;
  readonly recorder: Recorder;
  readonly press: (kind: PressKind, options?: { readonly only?: number }) => Promise<Outcome>;
  /** What a press would do now. */
  readonly next: (kind: PressKind) => core.Action;
  readonly busy: () => boolean;
  /** A held step released from its own notice, in any order. */
  readonly release: (id: number) => void;
  readonly cut: (cids: ReadonlySet<string>) => void;
  readonly invalidate: (tags: ReadonlySet<string>) => void;
  /** Content ids the history names: their bytes must stay. */
  readonly holds: () => Set<string>;
  readonly stacks: () => Stacks;
  readonly waits: () => readonly Wait[];
  readonly subscribe: (listener: () => void) => () => void;
  readonly stop: () => void;
}

interface OpenWait {
  readonly wait: Wait;
  readonly replaces: boolean;
  cancel: () => void;
}

export function createUndo(options: UndoOptions): Undo {
  const { gestures, view, hooks, holdMs, now = Date.now } = options;
  const slices = new Map<string, Slice>();
  const listeners = new Set<() => void>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let stacks = core.emptyStacks();
  let waits: OpenWait[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  let pressing = 0;

  const checked = new Set<string>();
  const env: Env = {
    cidsOf: (patch: Patch) => slices.get(patch.slice)?.cids?.(patch) ?? [],
    stepLimit: options.stepLimit ?? STEP_LIMIT,
    checked,
  };

  const notify = () => {
    for (const listener of listeners) listener();
  };

  /** Steps that left the history for good: a held one commits, commands let
   * go. One that throws does not keep the rest from going. */
  const dispose = (dropped: readonly Step[]) => {
    for (const step of dropped) {
      const timer = timers.get(step.id);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(step.id);
      }
      for (const leave of [step.held?.commit, ...step.commands.map((c) => c.dispose)]) {
        try {
          leave?.();
        } catch (error) {
          console.error("[undo] a step could not let go", step.name, error);
        }
      }
    }
  };

  const apply = (change: Change) => {
    stacks = change.stacks;
    dispose(change.dropped);
  };

  const named = () => {
    const out = new Set<string>();
    for (const slice of slices.values()) for (const cid of slice.named?.() ?? []) out.add(cid);
    return out;
  };

  const budget = () => apply(evict(stacks, named(), options.byteBudget ?? BYTE_BUDGET));

  const cancelWaits = (test: (open: OpenWait) => boolean) => {
    const gone = waits.filter(test);
    if (gone.length === 0) return;
    waits = waits.filter((open) => !test(open));
    for (const open of gone) open.cancel();
  };

  const recordDraft = (draft: Draft) => {
    const recorded = core.record(stacks, draft, env);
    apply(recorded);
    // a newer step in the scope makes a list it would replace stale
    if (recorded.step) cancelWaits((open) => open.replaces && open.wait.scope === draft.scope);
    return recorded.step;
  };

  const recorder = createRecorder({
    gestures,
    view,
    now,
    ...(options.log && { log: options.log }),
    sink: {
      record: (drafts) => {
        for (const draft of drafts) recordDraft(draft);
        budget();
        notify();
      },
      touch: (cells) => {
        stacks = core.touch(stacks, cells);
      },
      join: (scope, slice, moves) => {
        apply(
          core.join(
            stacks,
            moves.map((m) => ({ scope, slice, ...m })),
            env,
          ),
        );
        notify();
      },
    },
  });

  const facts = (only?: number): Facts => ({
    view: view(),
    waits: waits.map((open) => open.wait),
    recorded: options.recorded,
    editor: null,
    ...(only !== undefined && { only }),
  });

  const plan = (kind: PressKind, only?: number) =>
    (kind === "undo" ? core.undo : core.redo)(stacks, facts(only), env);

  const bare = (scope: Scope, name: StepName, extra: Partial<Draft>): Draft => ({
    scope,
    view: view(),
    at: now(),
    name,
    patches: [],
    riders: [],
    context: null,
    commands: [],
    typing: null,
    tag: null,
    held: null,
    ...extra,
  });

  /** Run after every press already queued; a failure does not stop the queue. */
  const enqueue = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch((error: unknown) => console.error("[undo]", error));
    return run;
  };

  /** Commit a held step once it is due, behind any press already queued. */
  const schedule = (id: number, at: number) => {
    const due = () => {
      timers.delete(id);
      void enqueue(() => {
        apply(core.remove(stacks, id));
        notify();
      });
    };
    timers.set(id, setTimeout(due, Math.max(0, at - now())));
  };

  const runCommands = async (step: Step, side: Side): Promise<Outcome> => {
    const commands = side === "before" ? [...step.commands].reverse() : step.commands;
    for (const command of commands) {
      try {
        await (side === "before" ? command.undo() : command.redo());
      } catch (error) {
        // with no patch the server's state is all the step was, and it is unknown now
        const dropped = step.patches.length === 0 && step.riders.length === 0;
        if (dropped) apply(core.remove(stacks, step.id));
        notify();
        return { kind: "replayed", step, side, gaveUp: [], failed: { error, dropped } };
      }
    }
    return { kind: "replayed", step, side, gaveUp: [], failed: null };
  };

  const handle = async (kind: PressKind, only?: number): Promise<Outcome> => {
    recorder.close();
    let press = plan(kind, only);
    const action = press.action;
    if (action.kind === "none") {
      // the press may still have dropped steps that gave up every key they held
      apply({ stacks: press.stacks, dropped: press.dropped });
      if (press.dropped.length > 0) notify();
      return { kind: "none" };
    }
    if (action.kind === "cancel") {
      cancelWaits((open) => open.wait.id === action.wait.id);
      notify();
      return { kind: "cancelled", wait: action.wait };
    }
    if (action.kind === "release") {
      apply({ stacks: press.stacks, dropped: press.dropped });
      const timer = timers.get(action.step.id);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(action.step.id);
      action.step.held?.undo();
      notify();
      return { kind: "released", step: action.step };
    }
    if (action.kind !== "replay") return { kind: "none" };

    const step = action.step;
    const guards = step.commands.flatMap((c) => (c.guard ? [c.guard] : []));
    if (guards.length > 0) {
      const reverts: (() => void)[] = [];
      try {
        for (const guard of guards) {
          const revert = await guard(action.side);
          if (revert) reverts.push(revert);
        }
      } catch (error) {
        for (const revert of reverts.reverse()) revert();
        return { kind: "refused", step, error };
      }
      recorder.close();
      press = plan(kind, only);
      const again = press.action;
      if (again.kind !== "replay" || again.step.id !== step.id) {
        for (const revert of reverts.reverse()) revert();
        return { kind: "stale" };
      }
    }
    const moved = press.action.kind === "replay" ? press.action : action;
    // one tick: the history moves and the document follows
    apply({ stacks: press.stacks, dropped: press.dropped });
    replay(moved.step, moved.side, slices, recorder, hooks);
    notify();
    const outcome = await runCommands(moved.step, moved.side);
    return outcome.kind === "replayed" ? { ...outcome, gaveUp: moved.gaveUp } : outcome;
  };

  const press: Undo["press"] = (kind, pressOptions) =>
    enqueue(async () => {
      pressing += 1;
      notify();
      try {
        return await handle(kind, pressOptions?.only);
      } finally {
        pressing -= 1;
        notify();
      }
    });

  const wait = (scope: Scope, name: StepName, waitOptions?: WaitOptions): WaitHandle => {
    recorder.close();
    const reserved = core.reserve(stacks);
    stacks = reserved.stacks;
    const at = view();
    let cancelled = false;
    const open: OpenWait = {
      wait: { id: reserved.id, scope, view: at },
      replaces: waitOptions?.replaces ?? false,
      cancel: () => {
        cancelled = true;
      },
    };
    waits = [...waits, open];
    notify();
    const leave = () => {
      waits = waits.filter((w) => w !== open);
    };
    return {
      get cancelled() {
        return cancelled;
      },
      land: (fn) => {
        if (cancelled) return false;
        leave();
        recorder.landing(at, name, fn);
        notify();
        return true;
      },
      end: () => {
        leave();
        notify();
      },
    };
  };

  const clearScope = (scope: Scope) => {
    recorder.close();
    apply(core.clear(stacks, scope));
    cancelWaits((open) => open.wait.scope === scope);
    notify();
  };

  const marks: Marks = {
    note: (scope, name, noteOptions) => recorder.note(scope, name, noteOptions?.quiet ?? false),
    title: (name) => recorder.title(name),
    attach: (scope, command) => recorder.attach(scope, command),
    ignore: (origin, fn) => recorder.ignore(origin, fn),
    follow: (origin, fn) => recorder.follow(origin, fn),
    recorded: (fn, recordedOptions) =>
      recorder.recorded(fn, recordedOptions?.view, recordedOptions?.title),
    wait,
    command: (scope, name, command: Command) => {
      recorder.close();
      recordDraft(bare(scope, name, { commands: [command] }));
      budget();
      notify();
    },
    hold: (scope, name, action: HeldAction) => {
      recorder.close();
      const until = now() + holdMs;
      const step = recordDraft(bare(scope, name, { held: { ...action, until } }));
      if (step) schedule(step.id, until);
      notify();
    },
    clear: clearScope,
    rehydrating: (store, on) => {
      recorder.deafen(store, on);
      if (on) return;
      const scopes = new Set(
        [...slices.values()].filter((s) => s.store === store).map((s) => s.scope),
      );
      for (const scope of scopes) clearScope(scope);
    },
  };

  return {
    add: (slice) => {
      slices.set(slice.name, slice);
      for (const c of slice.checked ?? []) checked.add(c);
      recorder.add(slice);
    },
    marks,
    recorder,
    press,
    next: (kind) => plan(kind).action,
    busy: () => pressing > 0,
    release: (id) => {
      const step = core.allSteps(stacks).find((s) => s.id === id);
      if (!step?.held) return;
      const timer = timers.get(id);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(id);
      stacks = core.remove(stacks, id).stacks;
      step.held.undo();
      notify();
    },
    cut: (cids) => {
      recorder.close();
      apply(core.cut(stacks, cids));
      notify();
    },
    invalidate: (tags) => {
      apply(core.invalidate(stacks, tags));
      notify();
    },
    holds: () => core.holds(stacks),
    stacks: () => stacks,
    waits: () => waits.map((open) => open.wait),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop: () => {
      recorder.stop();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
