// Small builders for undo tests: items and values name content ids through a
// `cids` record, and drafts default to an Images step made in the Images view.

import type { NavView } from "@/lib/constants";
import { STEP_LIMIT } from "./budget";
import type { Draft, EditorFacts, Env, Facts, KeyPatch, ListPatch, Patch, Scope } from "./types";

/** An item of a list slice, naming content ids with their bytes. */
export interface Item {
  readonly id: string;
  readonly v?: number;
  readonly cids?: Readonly<Record<string, number>>;
}

export const item = (id: string, v = 0, cids: Record<string, number> = {}): Item => ({
  id,
  v,
  cids,
});

function named(value: unknown): [string, number][] {
  if (typeof value !== "object" || value === null || !("cids" in value)) return [];
  return Object.entries((value as Item).cids ?? {});
}

export const env: Env = {
  cidsOf: (patch: Patch) => {
    if (patch.kind === "keys")
      return [...Object.values(patch.before), ...Object.values(patch.after)].flatMap(named);
    return Object.values(patch.items).flatMap((c) => [...named(c.before), ...named(c.after)]);
  },
  stepLimit: STEP_LIMIT,
  checked: new Set(),
};

export const keys = (
  slice: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): KeyPatch => ({
  slice,
  kind: "keys",
  before,
  after,
});

/** One item of a list slice changed, without a change of membership or order. */
export const changed = (slice: string, before: Item, after: Item): ListPatch => ({
  slice,
  kind: "list",
  items: { [before.id]: { before, after } },
  order: null,
  keys: { before: {}, after: {} },
});

export function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    scope: "images",
    view: "images",
    at: 0,
    name: { kind: "test" },
    patches: [keys("settings", { steps: 20 }, { steps: 30 })],
    riders: [],
    context: null,
    commands: [],
    typing: null,
    tag: null,
    held: null,
    ...overrides,
  };
}

/** A draft of `scope` made from `view`. */
export const made = (scope: Scope, view: NavView, overrides: Partial<Draft> = {}): Draft =>
  draft({ scope, view, ...overrides });

export const FIRST_BUILD: ReadonlySet<Scope> = new Set<Scope>(["images", "gallery", "shared"]);

export function facts(view: NavView, overrides: Partial<Facts> = {}): Facts {
  return { view, waits: [], recorded: FIRST_BUILD, editor: null, ...overrides };
}

export const editorFacts = (overrides: Partial<EditorFacts> = {}): EditorFacts => ({
  canUndo: false,
  canRedo: false,
  atOpen: false,
  ...overrides,
});
