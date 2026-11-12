// The recorder: watches the recorded slices and turns what changed during one
// user action into steps. It keeps a snapshot per slice; a write seen while a
// gesture, a landing or `recorded` is open opens the pending step, which
// closes when that ends and is diffed against the snapshot. Any other write is
// a settle write: no step, and the snapshot moves on. A gesture can outlast
// its event by a task; a write seen then closes the step as of before it.

import type { NavView } from "@/lib/constants";
import { cell } from "@/lib/undo/patch";
import {
  SCOPES,
  type Command,
  type Draft,
  type Patch,
  type Scope,
  type StepName,
} from "@/lib/undo/types";
import type { Gestures } from "./gesture";
import type { ItemMove, Slice } from "./slice";

/** Where steps and outside writes go: the history. */
export interface Sink {
  /** Steps of one action, recorded in order. */
  readonly record: (drafts: readonly Draft[]) => void;
  /** Checked keys written by no step. */
  readonly touch: (cells: readonly string[]) => void;
  /** Follow-up writes to list items outside any step. */
  readonly join: (scope: Scope, slice: string, moves: readonly ItemMove[]) => void;
}

export interface SettleWrite {
  readonly slice: string;
  readonly patch: Patch;
  /** What the stores said they were doing. */
  readonly notes: readonly StepName[];
}

export interface RecorderLog {
  readonly closed?: (drafts: readonly Draft[]) => void;
  readonly settle?: (write: SettleWrite) => void;
  /** A declared write ran: an `ignore` or a `follow`, by origin. */
  readonly declared?: (kind: "ignore" | "follow", origin: string) => void;
}

export interface RecorderOptions {
  readonly gestures: Gestures;
  readonly sink: Sink;
  /** The view on screen. */
  readonly view: () => NavView;
  readonly now?: () => number;
  readonly log?: RecorderLog;
}

type Mode =
  | { readonly kind: "landing"; readonly view: NavView }
  | { readonly kind: "recorded"; readonly view: NavView | undefined }
  | { readonly kind: "follow" }
  | { readonly kind: "ignore" }
  | { readonly kind: "replay" };

interface Pending {
  /** The view the step was made from; null takes each scope's own. */
  readonly view: NavView | null;
  /** A gesture opened it: native typing in it can join the step before. */
  readonly gesture: boolean;
  readonly at: number;
  readonly context: ReadonlyMap<Slice, unknown>;
}

interface Note {
  readonly scope: Scope;
  readonly name: StepName;
  readonly quiet: boolean;
  /** Made while a step could be recorded: in a gesture, a landing or `recorded`. */
  readonly live: boolean;
}

export interface Recorder {
  readonly add: (slice: Slice) => void;
  /** Close the pending step now. */
  readonly close: () => void;
  readonly note: (scope: Scope, name: StepName, quiet?: boolean) => void;
  readonly title: (name: StepName) => void;
  readonly attach: (scope: Scope, command: Command) => void;
  readonly ignore: <T>(origin: string, fn: () => T) => T;
  readonly follow: <T>(origin: string, fn: () => T) => T;
  readonly recorded: <T>(fn: () => T, view?: NavView, title?: StepName) => T;
  /** A wait's result: one step made from the view the wait began in. */
  readonly landing: <T>(view: NavView, name: StepName, fn: () => T) => T;
  /** Write a step's side: nothing in it or set off by it is a step. */
  readonly replaying: <T>(fn: () => T) => T;
  readonly deafen: (store: object, on: boolean) => void;
  readonly stop: () => void;
}

/** The name a change gets when no action or store named it. */
function derived(patches: readonly Patch[]): StepName {
  const keys = patches.flatMap((p) => Object.keys(p.kind === "keys" ? p.before : p.keys.before));
  const first = patches.at(0);
  if (!first) return { kind: "command" };
  if (patches.length === 1 && first.kind === "keys" && keys.length === 1) {
    return { kind: "set", args: { slice: first.slice, key: keys[0] } };
  }
  if (patches.length === 1 && first.kind === "list")
    return { kind: "edit", args: { slice: first.slice } };
  return { kind: "set", args: { count: keys.length } };
}
/** A slice as last observed: its recorded part and its selection. */
interface Seen {
  readonly value: unknown;
  readonly context: unknown;
}

const scoped = (mode: Mode): mode is Extract<Mode, { readonly kind: "landing" | "recorded" }> =>
  mode.kind === "landing" || mode.kind === "recorded";

export function createRecorder(options: RecorderOptions): Recorder {
  const { gestures, sink, view, now = Date.now, log } = options;
  const slices: Slice[] = [];
  const unsubscribe: (() => void)[] = [];
  /** What each slice held when the last step or settle write was taken. */
  const snap = new Map<Slice, unknown>();
  const context = new Map<Slice, unknown>();
  /** What each slice held at its last notification: the state before the one
   * being handled, for a step that must close as of then. */
  const seen = new Map<Slice, Seen>();
  const deafStores = new Set<object>();
  const modes: Mode[] = [];
  let pending: Pending | null = null;
  let notes: Note[] = [];
  let titled: StepName | null = null;
  let commands = new Map<Scope, Command[]>();

  const deafMode = () => modes.some((m) => m.kind === "ignore" || m.kind === "replay");
  const deaf = (slice: Slice) => deafStores.has(slice.store) || deafMode();
  const recording = () => gestures.open() || modes.some(scoped);
  const following = () => modes.some((m) => m.kind === "follow");

  const observe = (slice: Slice): Seen => {
    const current = { value: slice.read(), context: slice.context?.() };
    seen.set(slice, current);
    return current;
  };
  const settleTo = (slice: Slice, current: Seen) => {
    snap.set(slice, current.value);
    if (slice.context) context.set(slice, current.context);
  };

  /** Checked keys a patch changed, reported as written by no step. */
  const touchChecked = (slice: Slice, patch: Patch | null) => {
    if (!patch || !slice.checked?.length || patch.kind !== "keys") return;
    const cells = Object.keys(patch.before)
      .map((key) => cell(slice.name, key))
      .filter((c) => slice.checked?.includes(c));
    if (cells.length > 0) sink.touch(cells);
  };

  const openPending = () => {
    const outer = [...modes].reverse().find(scoped);
    const gesture = !outer && gestures.open();
    const at = outer ? (outer.view ?? null) : gesture ? view() : null;
    pending = { view: at, gesture, at: now(), context: new Map(context) };
  };

  /**
   * Close the pending step. With `asOf`, as the slices were last observed: a
   * write from outside the step's gesture is being handled, and the step ends
   * before it.
   */
  const close = (asOf = false) => {
    const open = pending;
    pending = null;
    // a note made outside the gesture belongs to the write that follows it
    const named = asOf ? notes.filter((n) => n.live) : notes;
    notes = asOf ? notes.filter((n) => !n.live) : [];
    const title = titled;
    titled = null;
    const attached = commands;
    commands = new Map();
    if (!open && attached.size === 0) return;

    const byScope = new Map<Scope, Patch[]>();
    const contexts = new Map<Scope, Draft["context"]>();
    const riders: Patch[] = [];
    const shared: Patch[] = [];
    if (open) {
      for (const slice of slices) {
        if (deafStores.has(slice.store)) continue;
        const current = (asOf && seen.get(slice)) || observe(slice);
        const patch = slice.diff(snap.get(slice), current.value);
        settleTo(slice, current);
        if (!patch) continue;
        if (slice.scope === "shared") (slice.checked?.length ? riders : shared).push(patch);
        else byScope.set(slice.scope, [...(byScope.get(slice.scope) ?? []), patch]);
        if (slice.context) {
          contexts.set(slice.scope, { before: open.context.get(slice), after: current.context });
        }
      }
    }

    // a command attached outside any step was made from the view on screen
    const viewOf = (scope: Scope): NavView =>
      open ? (open.view ?? (scope === "shared" ? view() : scope)) : view();
    const nameOf = (scope: Scope, patches: readonly Patch[]): StepName =>
      title ?? named.find((n) => n.scope === scope && !n.quiet)?.name ?? derived(patches);
    const draft = (scope: Scope, patches: Patch[], withRiders: Patch[]): Draft => ({
      scope,
      view: viewOf(scope),
      at: open?.at ?? now(),
      name: nameOf(scope, [...patches, ...withRiders]),
      patches,
      riders: withRiders,
      context: contexts.get(scope) ?? null,
      commands: attached.get(scope) ?? [],
      typing: null,
      tag: open?.gesture ? gestures.tag() : null,
      held: null,
    });

    const docs = SCOPES.filter((s) => s !== "shared" && (byScope.has(s) || attached.has(s)));
    const drafts = docs.map((scope) =>
      draft(scope, byScope.get(scope) ?? [], docs.length === 1 ? riders : []),
    );
    const own = [...(docs.length === 1 ? [] : riders), ...shared];
    if (own.length > 0 || attached.has("shared")) drafts.push(draft("shared", own, []));
    if (drafts.length === 0) return;
    log?.closed?.(drafts);
    sink.record(drafts);
  };

  /** The pending step's gesture is over although the gesture has not ended:
   * what runs now is another task. */
  const stale = () => pending !== null && pending.gesture && !gestures.open();

  /** Whether a step can be recorded now, asked before a declaration is kept:
   * a gesture found only now closes what came before it, and a step whose
   * event is over does not take what is declared after it. */
  const arriving = () => {
    const live = recording();
    if (!live && pending?.gesture) close();
    return live;
  };

  const settle = (slice: Slice, was: unknown, current: Seen) => {
    const patch = slice.diff(was, current.value);
    settleTo(slice, current);
    touchChecked(slice, patch);
    if (!patch) return;
    const said = notes.map((n) => n.name);
    notes = [];
    log?.settle?.({ slice: slice.name, patch, notes: said });
  };

  const onWrite = (slice: Slice) => {
    if (deaf(slice)) return;
    if (stale()) close(true);
    const current = observe(slice);
    const was = snap.get(slice);
    if (slice.same(was, current.value)) {
      if (!pending && slice.context) context.set(slice, current.context);
      return;
    }
    // a follow-up write outside a step is joined or settled when its follow returns
    if (pending || following()) return;
    if (recording()) openPending();
    else settle(slice, was, current);
  };

  const resnap = (touching: boolean) => {
    for (const slice of slices) {
      if (deafStores.has(slice.store)) continue;
      const current = observe(slice);
      if (touching) touchChecked(slice, slice.diff(snap.get(slice), current.value));
      settleTo(slice, current);
    }
    notes = [];
  };

  /** Follow-up writes made with no step pending: list items join the steps
   * they follow, everything else settles without a word. */
  const settleFollow = () => {
    for (const slice of slices) {
      if (deafStores.has(slice.store)) continue;
      const was = snap.get(slice);
      const current = observe(slice);
      if (!slice.same(was, current.value)) {
        const moves = slice.moves?.(was, current.value) ?? [];
        if (moves.length > 0) sink.join(slice.scope, slice.name, moves);
        touchChecked(slice, slice.diff(was, current.value));
      }
      settleTo(slice, current);
    }
    notes = [];
  };

  const run = <T>(mode: Mode, fn: () => T): T => {
    modes.push(mode);
    try {
      return fn();
    } finally {
      modes.pop();
    }
  };

  unsubscribe.push(gestures.listen({ start: () => close(), end: () => close() }));

  return {
    add: (slice) => {
      slices.push(slice);
      settleTo(slice, observe(slice));
      unsubscribe.push(slice.subscribe(() => onWrite(slice)));
    },
    close: () => close(),
    note: (scope, name, quiet = false) => {
      notes.push({ scope, name, quiet, live: recording() });
    },
    title: (name) => {
      arriving();
      titled ??= name;
    },
    attach: (scope, command) => {
      if (deafMode()) {
        command.dispose?.();
        return;
      }
      const live = arriving();
      commands.set(scope, [...(commands.get(scope) ?? []), command]);
      if (pending) return;
      // the step takes its view and time now, patch or no patch
      if (live) openPending();
      else close();
    },
    ignore: (origin, fn) => {
      log?.declared?.("ignore", origin);
      close();
      try {
        return run({ kind: "ignore" }, fn);
      } finally {
        // nested in a replay or another ignore, that one takes the snapshot
        if (!deafMode()) resnap(true);
      }
    },
    follow: (origin, fn) => {
      log?.declared?.("follow", origin);
      if (stale()) close();
      if (pending || deafMode() || following()) return run({ kind: "follow" }, fn);
      try {
        return run({ kind: "follow" }, fn);
      } finally {
        settleFollow();
      }
    },
    recorded: (fn, at, name) => {
      close();
      if (name) titled = name;
      try {
        return run({ kind: "recorded", view: at }, fn);
      } finally {
        close();
      }
    },
    landing: (at, name, fn) => {
      close();
      titled = name;
      try {
        return run({ kind: "landing", view: at }, fn);
      } finally {
        close();
      }
    },
    replaying: (fn) => {
      close();
      try {
        return run({ kind: "replay" }, fn);
      } finally {
        if (!deafMode()) resnap(false);
        gestures.end();
      }
    },
    deafen: (store, on) => {
      if (on) {
        close();
        deafStores.add(store);
        return;
      }
      if (!deafStores.delete(store)) return;
      for (const slice of slices) {
        if (slice.store === store) settleTo(slice, observe(slice));
      }
    },
    stop: () => {
      for (const off of unsubscribe.splice(0)) off();
    },
  };
}
