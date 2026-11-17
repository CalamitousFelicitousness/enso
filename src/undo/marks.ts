// What stores and actions declare about their writes, for the undo history.
// A leaf: it imports no store. Until the history starts, `ignore`, `follow`
// and `recorded` only run their function, a wait always lands, and the rest
// do nothing; an announcement says nothing.

import type { NavView } from "@/lib/constants";
import type { Command, Scope, StepName } from "@/lib/undo/types";

/** An action that writes after an await. */
export interface WaitHandle {
  /** Undo, a newer step replacing the list, or a clear cancelled it. */
  readonly cancelled: boolean;
  /** Aborted when the wait is cancelled: what it reads stops at once. */
  readonly signal: AbortSignal;
  /** Write the result as one step, under `name` when the outcome names it
   * better than the wait did; false, without running `fn`, once cancelled. */
  land(fn: () => void, name?: StepName): boolean;
  /** The action ended without landing. */
  end(): void;
  /** Say how far it got, in a notice of its own with Cancel; at most once a second. */
  progress(text: string): void;
}

export interface AnnounceOptions {
  readonly description?: string | null;
  /** A second button beside Undo. */
  readonly also?: { readonly label: string; readonly onClick: () => void };
}

/** The notice of the step an action made. */
export interface Announcement {
  /** Say what the step did, with its Undo; plainly when no step was made. A
   * newer step in its stack, or its own undo, takes the notice away. */
  show(text: string, options?: AnnounceOptions): void;
}

export interface WaitOptions {
  /** It replaces the scope's list: a newer step there cancels it. */
  readonly replaces?: boolean;
}

export interface RecordedOptions {
  /** The view the step counts as made from; the scope's own view by default. */
  readonly view?: NavView;
  readonly title?: StepName;
}

export interface NoteOptions {
  /** A consequence that never names a step: the Fit chain's refit. */
  readonly quiet?: boolean;
}

export interface HeldAction {
  readonly undo: () => void;
  readonly commit: () => void;
}

export interface Marks {
  /** A store reducer names its change. */
  note(scope: Scope, name: StepName, options?: NoteOptions): void;
  /** An action names the step it is making; wins over notes. */
  title(name: StepName): void;
  /** The notice of the step being made in `scope`, shown when the action says. */
  announce(scope: Scope): Announcement;
  /** A server request rides on the step being made in `scope`. */
  attach(scope: Scope, command: Command): void;
  /** Writes that are never a step. */
  ignore<T>(origin: string, fn: () => T): T;
  /** Writes derived from the state: part of the step being made, else joined
   * to the step whose result they follow. */
  follow<T>(origin: string, fn: () => T): T;
  /** A user action that completes outside its input event. */
  recorded<T>(fn: () => T, options?: RecordedOptions): T;
  wait(scope: Scope, name: StepName, options?: WaitOptions): WaitHandle;
  /** A step with no patch: a server request alone. */
  command(scope: Scope, name: StepName, command: Command): Announcement;
  /** A server action held back until it commits; its notice releases it. */
  hold(scope: Scope, name: StepName, action: HeldAction): Announcement;
  /** The scope's document was replaced: its steps and waits go. */
  clear(scope: Scope): void;
  /** The store is being read from storage: none of its writes are steps. */
  rehydrating(store: object, on: boolean): void;
}

/** What actions ask of the history beside their declarations. */
export interface HistoryQueries {
  /** Content ids the history names, whose bytes must stay. */
  holds(): ReadonlySet<string>;
  /** Steps naming these content ids leave the history; how many went. */
  cut(cids: ReadonlySet<string>): number;
  /** How many steps a cut of these content ids would take. */
  cutSize(cids: ReadonlySet<string>): number;
  /** Server items deleted for good: the steps whose requests need them go. */
  invalidate(tags: ReadonlySet<string>): void;
}

const landed: WaitHandle = {
  cancelled: false,
  signal: new AbortController().signal,
  land: (fn) => {
    fn();
    return true;
  },
  end: () => {},
  progress: () => {},
};

const unheard: Announcement = { show: () => {} };

const idle: Marks = {
  note: () => {},
  title: () => {},
  announce: () => unheard,
  attach: () => {},
  ignore: (_origin, fn) => fn(),
  follow: (_origin, fn) => fn(),
  recorded: (fn) => fn(),
  wait: () => landed,
  command: () => unheard,
  hold: (_scope, _name, action) => {
    action.commit();
    return unheard;
  },
  clear: () => {},
  rehydrating: () => {},
};

const unrecorded: HistoryQueries = {
  holds: () => new Set(),
  cut: () => 0,
  cutSize: () => 0,
  invalidate: () => {},
};

let marks: Marks = idle;
let queries: HistoryQueries = unrecorded;

/** The history takes the declarations over. Returns the uninstall. */
export function install(impl: Marks, asked: HistoryQueries): () => void {
  marks = impl;
  queries = asked;
  return () => {
    if (marks === impl) marks = idle;
    if (queries === asked) queries = unrecorded;
  };
}

export const note: Marks["note"] = (scope, name, options) => marks.note(scope, name, options);
export const title: Marks["title"] = (name) => marks.title(name);
export const announce: Marks["announce"] = (scope) => marks.announce(scope);
export const attach: Marks["attach"] = (scope, command) => marks.attach(scope, command);
export const ignore: Marks["ignore"] = (origin, fn) => marks.ignore(origin, fn);
export const follow: Marks["follow"] = (origin, fn) => marks.follow(origin, fn);
export const recorded: Marks["recorded"] = (fn, options) => marks.recorded(fn, options);
export const wait: Marks["wait"] = (scope, name, options) => marks.wait(scope, name, options);
export const command: Marks["command"] = (scope, name, cmd) => marks.command(scope, name, cmd);
export const hold: Marks["hold"] = (scope, name, action) => marks.hold(scope, name, action);
export const clear: Marks["clear"] = (scope) => marks.clear(scope);
export const rehydrating: Marks["rehydrating"] = (store, on) => marks.rehydrating(store, on);
export const holds: HistoryQueries["holds"] = () => queries.holds();
export const cut: HistoryQueries["cut"] = (cids) => queries.cut(cids);
export const cutSize: HistoryQueries["cutSize"] = (cids) => queries.cutSize(cids);
export const invalidate: HistoryQueries["invalidate"] = (tags) => queries.invalidate(tags);
