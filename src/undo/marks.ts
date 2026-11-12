// What stores and actions declare about their writes, for the undo history.
// A leaf: it imports no store. Until the history starts, `ignore`, `follow`
// and `recorded` only run their function, a wait always lands, and the rest
// do nothing.

import type { NavView } from "@/lib/constants";
import type { Command, Scope, StepName } from "@/lib/undo/types";

/** An action that writes after an await. */
export interface WaitHandle {
  /** Undo, a newer step replacing the list, or a clear cancelled it. */
  readonly cancelled: boolean;
  /** Write the result as one step; false, without running `fn`, once cancelled. */
  land(fn: () => void): boolean;
  /** The action ended without landing. */
  end(): void;
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
  command(scope: Scope, name: StepName, command: Command): void;
  /** A server action held back until it commits. */
  hold(scope: Scope, name: StepName, action: HeldAction): void;
  /** The scope's document was replaced: its steps and waits go. */
  clear(scope: Scope): void;
  /** The store is being read from storage: none of its writes are steps. */
  rehydrating(store: object, on: boolean): void;
}

const landed: WaitHandle = {
  cancelled: false,
  land: (fn) => {
    fn();
    return true;
  },
  end: () => {},
};

const idle: Marks = {
  note: () => {},
  title: () => {},
  attach: () => {},
  ignore: (_origin, fn) => fn(),
  follow: (_origin, fn) => fn(),
  recorded: (fn) => fn(),
  wait: () => landed,
  command: () => {},
  hold: (_scope, _name, action) => action.commit(),
  clear: () => {},
  rehydrating: () => {},
};

let marks: Marks = idle;

/** The history takes the declarations over. Returns the uninstall. */
export function install(impl: Marks): () => void {
  marks = impl;
  return () => {
    if (marks === impl) marks = idle;
  };
}

export const note: Marks["note"] = (scope, name, options) => marks.note(scope, name, options);
export const title: Marks["title"] = (name) => marks.title(name);
export const attach: Marks["attach"] = (scope, command) => marks.attach(scope, command);
export const ignore: Marks["ignore"] = (origin, fn) => marks.ignore(origin, fn);
export const follow: Marks["follow"] = (origin, fn) => marks.follow(origin, fn);
export const recorded: Marks["recorded"] = (fn, options) => marks.recorded(fn, options);
export const wait: Marks["wait"] = (scope, name, options) => marks.wait(scope, name, options);
export const command: Marks["command"] = (scope, name, cmd) => marks.command(scope, name, cmd);
export const hold: Marks["hold"] = (scope, name, action) => marks.hold(scope, name, action);
export const clear: Marks["clear"] = (scope) => marks.clear(scope);
export const rehydrating: Marks["rehydrating"] = (store, on) => marks.rehydrating(store, on);
