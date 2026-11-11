// What the undo history holds: steps as data, one linear stack per scope.
// A step names the values recorded store slices held before and after one
// user action; only server requests, held steps and editor handles are code.

import type { NavView } from "@/lib/constants";

/** A document with a stack of its own, and the stack every view shares. */
export const SCOPES = ["images", "video", "process", "caption", "gallery", "shared"] as const;
export type Scope = (typeof SCOPES)[number];

export type Side = "before" | "after";

export type Values = Readonly<Record<string, unknown>>;

/** Keys of a flat slice whose values changed. */
export interface KeyPatch {
  readonly slice: string;
  readonly kind: "keys";
  readonly before: Values;
  readonly after: Values;
}

/** One item of a list slice; null on the side where it did not exist. */
export interface ItemChange {
  readonly before: unknown;
  readonly after: unknown;
}

/** Items of a list slice by id, its order, and the slice's other keys. */
export interface ListPatch {
  readonly slice: string;
  readonly kind: "list";
  readonly items: Readonly<Record<string, ItemChange>>;
  /** Present whenever membership or order changed. */
  readonly order: { readonly before: readonly string[]; readonly after: readonly string[] } | null;
  readonly keys: { readonly before: Values; readonly after: Values };
}

export type Patch = KeyPatch | ListPatch;

/** A step's name as data, worded when shown. */
export interface StepName {
  readonly kind: string;
  readonly args?: Readonly<Record<string, string | number>>;
}

/** The server half of a step. */
export interface Command {
  /** Must succeed before content leaves the document; a throw refuses the press. */
  readonly guard?: (side: Side) => Promise<void>;
  readonly undo: () => Promise<void> | void;
  readonly redo: () => Promise<void> | void;
  /** The step left the history for good: evicted, cut, cleared or dropped from Redo. */
  readonly dispose?: () => void;
  /** Server items it needs. */
  readonly tags: readonly string[];
}

/** A server action that cannot be taken back, held until it commits. */
export interface Held {
  readonly undo: () => void;
  readonly commit: () => void;
  readonly until: number;
}

/** A run of typing in a prompt editor, open while it is the latest step. A
 * closed run keeps no typing record. */
export interface Typing {
  /** The editor's handle; compared by identity. */
  readonly editor: object;
  /** The editor's text when the run began; the runtime judges emptiness by it. */
  readonly textAtOpen: string;
  /** The patches as of the last typed change, before any undo inside the editor. */
  readonly tip: readonly Patch[];
}

export interface Step {
  /** One counter for every stack: the order steps were recorded in. */
  readonly id: number;
  /** The counter when the step last changed sides. */
  readonly moved: number;
  readonly scope: Scope;
  readonly view: NavView;
  readonly at: number;
  readonly name: StepName;
  /** Slices of `scope`. */
  readonly patches: readonly Patch[];
  /** Checked shared keys changed with it. */
  readonly riders: readonly Patch[];
  /** The selection on each side, restored with the step and never a step itself. */
  readonly context: { readonly before: unknown; readonly after: unknown } | null;
  readonly commands: readonly Command[];
  /** Every content id the patches name, with its bytes. */
  readonly cids: ReadonlyMap<string, number>;
  readonly typing: Typing | null;
  /** The native text field's input tag; consecutive steps carrying it merge. */
  readonly tag: object | null;
  readonly held: Held | null;
  /** Per checked key the step holds, as `cell()` names it: the owner the
   * step wrote over when it was recorded. */
  readonly under: Readonly<Record<string, number>>;
}

/** A step before it is recorded; the history numbers it and counts its bytes. */
export type Draft = Omit<Step, "id" | "moved" | "cids" | "under">;

export interface Stack {
  /** Oldest first; the last is the next to undo. */
  readonly undo: readonly Step[];
  /** Furthest first; the last is the next to redo. */
  readonly redo: readonly Step[];
}

export interface Stacks {
  readonly byScope: Readonly<Record<Scope, Stack>>;
  /** The step recorded last, while no press has moved anything since. */
  readonly latest: number | null;
  /** The last number handed out to a step, a move, a wait or an outside write. */
  readonly counter: number;
  /** Per checked key, as `cell()` names it: who wrote it last. A step's id, or
   * a number of its own for a write no step made; absent before any write. */
  readonly owners: Readonly<Record<string, number>>;
}

/** An action that reads before it writes, cancelled by Undo until it lands. */
export interface Wait {
  readonly id: number;
  readonly scope: Scope;
  readonly view: NavView;
}

/** What the editor of the open typing step can do. */
export interface EditorFacts {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Its text is the text the run began with. */
  readonly atOpen: boolean;
}

/** What the runtime knows when a press is planned. */
export interface Facts {
  readonly view: NavView;
  readonly waits: readonly Wait[];
  /** Scopes whose own document is recorded; Undo from another view reaches
   * only what was done from it. */
  readonly recorded: ReadonlySet<Scope>;
  readonly editor: EditorFacts | null;
  /** Only this step may move: a notice's own Undo. */
  readonly only?: number;
}

/** What the history needs from the slices it does not know. */
export interface Env {
  /** The content ids a patch names, with their bytes. */
  readonly cidsOf: (patch: Patch) => Iterable<readonly [string, number]>;
  /** Steps per stack, both sides together. */
  readonly stepLimit: number;
  /** Keys more than one stack can hold, as `cell()` names them. A step writes
   * one only while it owns it, and gives it up for good otherwise. */
  readonly checked: ReadonlySet<string>;
}

/** A new history, and the steps that left it for good. */
export interface Change {
  readonly stacks: Stacks;
  readonly dropped: readonly Step[];
}
