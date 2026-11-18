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
  EditorFacts,
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
import type {
  AnnounceOptions,
  Announcement,
  HeldAction,
  Marks,
  WaitHandle,
  WaitOptions,
} from "./marks";
import { createRecorder, type Recorder, type RecorderLog } from "./recorder";
import { replay, type ReplayHooks } from "./replay";
import type { Slice } from "./slice";

export type PressKind = "undo" | "redo";

/** A prompt editor's own history, which serves its open typing run. */
export interface EditorHandle {
  /** One group of the editor's own history; false when it did nothing. */
  readonly undo: () => boolean;
  readonly redo: () => boolean;
  readonly undoDepth: () => number;
  readonly redoDepth: () => number;
  /** Empty the editor's own history. */
  readonly reset: () => void;
  readonly text: () => string;
}

export type Outcome =
  | { readonly kind: "none" }
  /** The open typing run's editor stepped its own history. */
  | { readonly kind: "typed"; readonly step: Step }
  | { readonly kind: "cancelled"; readonly wait: Wait; readonly name: StepName | null }
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

/** What the history tells the user; the runtime shows it. */
export interface Notices {
  /** A step's doing notice, or a plain one when the action made no step. */
  readonly doing: (step: Step | null, text: string, options: AnnounceOptions) => void;
  /** How far a wait got, in its own notice with Cancel. */
  readonly progress: (wait: Wait, name: StepName, text: string) => void;
  /** What a press did. */
  readonly pressed: (kind: PressKind, outcome: Outcome) => void;
}

export interface UndoOptions {
  readonly gestures: Gestures;
  readonly notices?: Notices;
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
  /** A prompt editor changed its text: `write` puts it in the store at once,
   * and the change extends the editor's typing run or opens one. */
  readonly typing: (
    editor: EditorHandle,
    kind: core.TypingKind,
    textAtOpen: string,
    write: () => void,
  ) => void;
  /** The editor hid or is going away: its typing run closes. */
  readonly closeTyping: (editor: EditorHandle) => void;
  /** A text field was typed into and the history never recorded its typing:
   * the typing is the field's own to undo. */
  readonly typedUnrecorded: (field: object) => boolean;
  /** What a press would do now. */
  readonly next: (kind: PressKind) => core.Action;
  readonly busy: () => boolean;
  /** A held step released from its own notice, in any order. */
  readonly release: (id: number) => void;
  /** A wait cancelled from its own notice, in any order. */
  readonly cancel: (waitId: number) => void;
  /** What an open wait is called. */
  readonly waitName: (waitId: number) => StepName | null;
  /** Steps naming these content ids leave the history; how many went. */
  readonly cut: (cids: ReadonlySet<string>) => number;
  /** How many steps a cut of these content ids would take. */
  readonly cutSize: (cids: ReadonlySet<string>) => number;
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
  readonly name: StepName;
  readonly replaces: boolean;
  cancel: () => void;
}

const PROGRESS_EVERY_MS = 1000;

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

  const editorOf = (step: Step | null): EditorHandle | null =>
    (step?.typing?.editor as EditorHandle | undefined) ?? null;

  /** The text an editor's own last change left: a store write the editor
   * already shows, such as the one a closing step makes, is not its run's. */
  let typed: { readonly editor: EditorHandle; readonly text: string } | null = null;

  /** What the open typing run's editor can do. */
  const editorFacts = (): EditorFacts | null => {
    const open = core.openTyping(stacks);
    const editor = editorOf(open);
    if (!open?.typing || !editor) return null;
    const text = typed?.editor === editor ? typed.text : editor.text();
    return {
      canUndo: editor.undoDepth() > 0,
      canRedo: editor.redoDepth() > 0,
      atOpen: text === open.typing.textAtOpen,
    };
  };

  const apply = (change: Change) => {
    const open = core.openTyping(stacks);
    stacks = change.stacks;
    // a closed run is a step of the history now: the editor's own groups would undo it twice
    if (open && core.openTyping(stacks)?.id !== open.id) editorOf(open)?.reset();
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
    const recorded = core.record(stacks, draft, env, editorFacts());
    apply(recorded);
    // a newer step in the scope makes a list it would replace stale
    if (recorded.step) cancelWaits((open) => open.replaces && open.wait.scope === draft.scope);
    if (recorded.step?.tag) gestures.recordedTyping(recorded.step.tag);
    return recorded.step;
  };

  const recorder = createRecorder({
    gestures,
    view,
    now,
    ...(options.log && { log: options.log }),
    sink: {
      record: (drafts) => {
        const steps = drafts.map(recordDraft);
        budget();
        notify();
        return steps;
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

  /** With `stuck`, the editor's own history did nothing when asked. */
  const facts = (only?: number, stuck = false): Facts => {
    const editor = editorFacts();
    return {
      view: view(),
      waits: waits.map((open) => open.wait),
      recorded: options.recorded,
      editor: editor && stuck ? { ...editor, canUndo: false, canRedo: false } : editor,
      ...(only !== undefined && { only }),
    };
  };

  const plan = (kind: PressKind, only?: number, stuck = false) =>
    (kind === "undo" ? core.undo : core.redo)(stacks, facts(only, stuck), env);

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

  /** The open typing run's editor steps its own history; null when that did
   * nothing, as in a read-only editor. */
  const typedPress = (kind: PressKind, press: core.Press): Outcome | null => {
    if (press.action.kind !== "editor") return null;
    const step = press.action.step;
    const editor = editorOf(step);
    apply({ stacks: press.stacks, dropped: press.dropped });
    // the editor's change comes back through `typing`, which extends the run
    const did = editor !== null && (kind === "undo" ? editor.undo() : editor.redo());
    gestures.end();
    notify();
    return did ? { kind: "typed", step } : null;
  };

  const handle = async (kind: PressKind, only?: number): Promise<Outcome> => {
    recorder.close();
    let press = plan(kind, only);
    const typed = typedPress(kind, press);
    if (typed) return typed;
    // the run closes and the press acts on it, or on what is next, as a step
    if (press.action.kind === "editor") press = plan(kind, only, true);
    const action = press.action;
    if (action.kind === "none") {
      // the press may still have dropped steps that gave up every key they held
      apply({ stacks: press.stacks, dropped: press.dropped });
      if (press.dropped.length > 0) notify();
      return { kind: "none" };
    }
    if (action.kind === "cancel") {
      const name = waits.find((open) => open.wait.id === action.wait.id)?.name ?? null;
      cancelWaits((open) => open.wait.id === action.wait.id);
      notify();
      return { kind: "cancelled", wait: action.wait, name };
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
        const outcome = await handle(kind, pressOptions?.only);
        options.notices?.pressed(kind, outcome);
        return outcome;
      } finally {
        pressing -= 1;
        notify();
      }
    });

  /** A typing run named by the key it writes, for when it is typed back to where it began. */
  const typingName = (draft: Draft): StepName => {
    const [patch] = draft.patches;
    const [key] = patch?.kind === "keys" ? Object.keys(patch.before) : [];
    return patch && key
      ? { kind: "typing", args: { slice: patch.slice, key } }
      : { kind: "typing" };
  };

  const typing: Undo["typing"] = (editor, kind, textAtOpen, write) => {
    const drafts = recorder.typing(write);
    const [draft] = drafts;
    if (draft && drafts.length === 1 && draft.scope !== "shared") {
      const was = core.openTyping(stacks);
      const run = { editor, textAtOpen, kind };
      const named = { ...draft, name: typingName(draft) };
      const recorded = core.recordTyping(stacks, named, run, env, editorFacts());
      apply(recorded);
      typed = { editor, text: editor.text() };
      if (recorded.step) cancelWaits((open) => open.replaces && open.wait.scope === draft.scope);
      if (core.openTyping(stacks)?.id !== was?.id) budget();
    } else {
      // ordinary steps, or none while the store is deaf: no run holds the change,
      // so the editor's own group for it would take it back a second time
      for (const each of drafts) recordDraft(each);
      if (drafts.length > 0) budget();
      if (editorOf(core.openTyping(stacks)) !== editor) editor.reset();
    }
    notify();
  };

  const closeTyping: Undo["closeTyping"] = (editor) => {
    if (editorOf(core.openTyping(stacks)) !== editor) return;
    apply(core.closeTyping(stacks, editorFacts(), env));
    notify();
  };

  /** The notice of a step the history now knows, or of no step. */
  const announcement = (): Announcement & { bind: (step: Step | null) => void } => {
    let bound: { step: Step | null } | null = null;
    let queued: { text: string; options: AnnounceOptions } | null = null;
    return {
      bind: (step) => {
        bound = { step };
        if (queued) options.notices?.doing(step, queued.text, queued.options);
        queued = null;
      },
      show: (text, showOptions = {}) => {
        if (bound) options.notices?.doing(bound.step, text, showOptions);
        else queued = { text, options: showOptions };
      },
    };
  };

  const wait = (scope: Scope, name: StepName, waitOptions?: WaitOptions): WaitHandle => {
    recorder.close();
    const reserved = core.reserve(stacks);
    stacks = reserved.stacks;
    const at = view();
    let cancelled = false;
    const abort = new AbortController();
    const open: OpenWait = {
      wait: { id: reserved.id, scope, view: at },
      name,
      replaces: waitOptions?.replaces ?? false,
      cancel: () => {
        cancelled = true;
        abort.abort();
      },
    };
    waits = [...waits, open];
    notify();
    const leave = () => {
      waits = waits.filter((w) => w !== open);
    };
    let shownAt = -Infinity;
    return {
      get cancelled() {
        return cancelled;
      },
      signal: abort.signal,
      land: (fn, landedAs) => {
        if (cancelled) return false;
        leave();
        recorder.landing(at, landedAs ?? name, fn);
        notify();
        return true;
      },
      end: () => {
        leave();
        notify();
      },
      progress: (text) => {
        const time = now();
        if (cancelled || time - shownAt < PROGRESS_EVERY_MS) return;
        shownAt = time;
        options.notices?.progress(open.wait, name, text);
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
    announce: (scope) => {
      const made = announcement();
      recorder.onStep(scope, made.bind);
      return made;
    },
    attach: (scope, command) => recorder.attach(scope, command),
    ignore: (origin, fn) => recorder.ignore(origin, fn),
    follow: (origin, fn) => recorder.follow(origin, fn),
    recorded: (fn, recordedOptions) =>
      recorder.recorded(fn, recordedOptions?.view, recordedOptions?.title),
    wait,
    command: (scope, name, command: Command) => {
      recorder.close();
      const step = recordDraft(bare(scope, name, { commands: [command] }));
      budget();
      notify();
      const made = announcement();
      made.bind(step);
      return made;
    },
    hold: (scope, name, action: HeldAction) => {
      recorder.close();
      const until = now() + holdMs;
      const step = recordDraft(bare(scope, name, { held: { ...action, until } }));
      if (step) schedule(step.id, until);
      notify();
      const made = announcement();
      made.bind(step);
      return made;
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
    typing,
    closeTyping,
    typedUnrecorded: (field) => gestures.typedUnrecorded(field),
    next: (kind) => plan(kind).action,
    busy: () => pressing > 0,
    cancel: (waitId) => {
      cancelWaits((open) => open.wait.id === waitId);
      notify();
    },
    waitName: (waitId) => waits.find((open) => open.wait.id === waitId)?.name ?? null,
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
      const change = core.cut(stacks, cids);
      apply(change);
      notify();
      return change.dropped.length;
    },
    cutSize: (cids) => core.cut(stacks, cids).dropped.length,
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
