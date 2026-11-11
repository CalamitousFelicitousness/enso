// The stacks of the undo history and every move on them: recording, the reach
// of a press, undo and redo, typing runs, joins of follow-up writes, cuts and
// clears. The press plans are what the Top Bar shows and what a press runs.

import type { NavView } from "@/lib/constants";
import { cell, cidsOf, compose, isEmpty, sameValue, span, touched, withoutKeys } from "./patch";
import {
  SCOPES,
  type Change,
  type Draft,
  type EditorFacts,
  type Env,
  type Facts,
  type ListPatch,
  type Patch,
  type Scope,
  type Side,
  type Stack,
  type Stacks,
  type Step,
  type Wait,
} from "./types";

const EMPTY: Stack = { undo: [], redo: [] };

export function emptyStacks(): Stacks {
  const byScope = Object.fromEntries(SCOPES.map((scope) => [scope, EMPTY]));
  return { byScope: byScope as Record<Scope, Stack>, latest: null, counter: 0, owners: {} };
}

/** The scope a view's own document is recorded in. */
export const scopeOf = (view: NavView): Scope => view;

const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1];

function withStack(stacks: Stacks, scope: Scope, stack: Stack): Stacks {
  return { ...stacks, byScope: { ...stacks.byScope, [scope]: stack } };
}

function withCids(step: Step, env: Env): Step {
  const named = [...step.patches, ...step.riders, ...(step.typing?.tip ?? [])];
  return { ...step, cids: cidsOf(named, env) };
}

/** The checked keys a step holds. */
function checkedOf(step: Pick<Step, "patches" | "riders">, env: Env): string[] {
  return [...step.patches, ...step.riders].flatMap((patch) =>
    patch.kind === "keys"
      ? Object.keys(patch.before)
          .map((key) => cell(patch.slice, key))
          .filter((c) => env.checked.has(c))
      : [],
  );
}

/** The step without the checked keys it gave up. */
function withoutChecked(step: Step, gaveUp: readonly string[], env: Env): Step {
  const cells = new Set(gaveUp);
  const under = Object.fromEntries(Object.entries(step.under).filter(([c]) => !cells.has(c)));
  const lean = {
    ...step,
    patches: withoutKeys(step.patches, cells),
    riders: withoutKeys(step.riders, cells),
    under,
  };
  return withCids(lean, env);
}

/** A checked key written by no step: every step that held its value loses it. */
export function touch(stacks: Stacks, cells: readonly string[]): Stacks {
  if (cells.length === 0) return stacks;
  const counter = stacks.counter + 1;
  const owners = { ...stacks.owners, ...Object.fromEntries(cells.map((c) => [c, counter])) };
  return { ...stacks, counter, owners };
}

/** Every step on either side of every stack. */
export function allSteps(stacks: Stacks): Step[] {
  return SCOPES.flatMap((scope) => [...stacks.byScope[scope].undo, ...stacks.byScope[scope].redo]);
}

/** Every content id a step names: the bytes the page must keep. */
export function holds(stacks: Stacks): Set<string> {
  return new Set(allSteps(stacks).flatMap((step) => [...step.cids.keys()]));
}

/** The open typing run: the latest step, when it is one. */
export function openTyping(stacks: Stacks): Step | null {
  if (stacks.latest === null) return null;
  for (const scope of SCOPES) {
    const step = last(stacks.byScope[scope].undo);
    if (step?.id === stacks.latest) return step.typing ? step : null;
  }
  return null;
}

/** A number for a wait, from the counter steps take theirs from. */
export function reserve(stacks: Stacks): { stacks: Stacks; id: number } {
  const id = stacks.counter + 1;
  return { stacks: { ...stacks, counter: id }, id };
}

const isBare = (step: Pick<Step, "patches" | "riders" | "commands" | "held">) =>
  step.patches.length === 0 &&
  step.riders.length === 0 &&
  step.commands.length === 0 &&
  step.held === null;

/** Close the open typing run. Its text back where the run began, it goes.
 * With `remainder`, what the editor's own undo stepped back from goes to the
 * redo side, so a run closed without a new step in its stack loses nothing. */
function closeOpen(
  stacks: Stacks,
  remainder: boolean,
  editor: EditorFacts | null,
  env: Env,
): Change {
  const open = openTyping(stacks);
  if (!open?.typing) return { stacks, dropped: [] };
  const atOpen = editor?.atOpen ?? false;
  const stack = stacks.byScope[open.scope];
  const below = stack.undo.slice(0, -1);
  const closed = withCids({ ...open, typing: null }, env);
  let counter = stacks.counter;
  let redo = stack.redo;
  const rest = remainder ? span(open.patches, open.typing.tip) : [];
  if (rest.length > 0) {
    counter += 1;
    const step: Step = {
      ...closed,
      id: counter,
      moved: counter,
      patches: rest,
      context: null,
      under: {},
    };
    redo = [...redo, withCids(step, env)];
  }
  const kept = atOpen ? below : [...below, closed];
  // the stepped-back part can take the stack over the step limit
  const over = Math.max(0, Math.min(kept.length, kept.length + redo.length - env.stepLimit));
  const undo = kept.slice(over);
  return {
    stacks: { ...withStack(stacks, open.scope, { undo, redo }), counter, latest: null },
    dropped: [...(atOpen ? [open] : []), ...kept.slice(0, over)],
  };
}

/** Close the open typing run because its editor hid or unmounted. */
export function closeTyping(stacks: Stacks, editor: EditorFacts | null, env: Env): Change {
  return closeOpen(stacks, true, editor, env);
}

type Context = Step["context"];

/** The selection from before the first change to after the second. */
function joinContext(a: Context, b: Context): Context {
  if (!a || !b) return a ?? b;
  return { before: a.before, after: b.after };
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((key) => b.has(key));

/** A native field's change joins the latest step when both carry its input tag
 * and touch the same keys or items. */
function mergeTagged(stacks: Stacks, draft: Draft, env: Env): Recorded | null {
  if (draft.tag === null || stacks.latest === null) return null;
  if (checkedOf(draft, env).length > 0) return null;
  const stack = stacks.byScope[draft.scope];
  const prev = last(stack.undo);
  if (!prev || prev.id !== stacks.latest || prev.tag !== draft.tag) return null;
  const was = touched([...prev.patches, ...prev.riders]);
  if (!sameSet(was, touched([...draft.patches, ...draft.riders]))) return null;
  const merged = {
    ...prev,
    patches: compose(prev.patches, draft.patches),
    riders: compose(prev.riders, draft.riders),
    commands: [...prev.commands, ...draft.commands],
    context: joinContext(prev.context, draft.context),
  };
  const below = stack.undo.slice(0, -1);
  if (isBare(merged)) {
    const next = withStack(stacks, draft.scope, { ...stack, undo: below });
    return { stacks: { ...next, latest: null }, dropped: [prev], step: null };
  }
  const step = withCids(merged, env);
  return {
    stacks: withStack(stacks, draft.scope, { ...stack, undo: [...below, step] }),
    dropped: [],
    step,
  };
}

export interface Recorded extends Change {
  /** The step as recorded, or null when nothing was. */
  readonly step: Step | null;
}

/** Record a step: it clears its own stack's redo side, closes the open typing
 * run, and over the step limit the oldest undo-side steps go. A change with
 * nothing in it records nothing. `editor` is what the open run's editor can do. */
export function record(
  stacks: Stacks,
  draft: Draft,
  env: Env,
  editor: EditorFacts | null = null,
): Recorded {
  if (isBare(draft)) return { stacks, dropped: [], step: null };
  const merged = mergeTagged(stacks, draft, env);
  if (merged) return merged;
  const open = openTyping(stacks);
  const closed = closeOpen(stacks, open !== null && open.scope !== draft.scope, editor, env);
  const id = closed.stacks.counter + 1;
  const mine = checkedOf(draft, env);
  const was = closed.stacks.owners;
  const under = Object.fromEntries(mine.map((c) => [c, was[c] ?? 0]));
  const owners =
    mine.length > 0 ? { ...was, ...Object.fromEntries(mine.map((c) => [c, id])) } : was;
  const step = withCids({ ...draft, id, moved: id, cids: new Map(), under }, env);
  const stack = closed.stacks.byScope[draft.scope];
  const dropped = [...closed.dropped, ...stack.redo];
  let undo = [...stack.undo, step];
  const over = undo.length - env.stepLimit;
  if (over > 0) {
    dropped.push(...undo.slice(0, over));
    undo = undo.slice(over);
  }
  const next = withStack(closed.stacks, draft.scope, { undo, redo: [] });
  return { stacks: { ...next, counter: id, latest: id, owners }, dropped, step };
}

export type TypingKind = "input" | "undo" | "redo";

/** A change a prompt editor made. While the editor's run is open it extends
 * the run, and a typed change moves the run's tip; otherwise it opens a run. */
export function recordTyping(
  stacks: Stacks,
  draft: Draft,
  run: { editor: object; textAtOpen: string; kind: TypingKind },
  env: Env,
  editor: EditorFacts | null = null,
): Recorded {
  const open = openTyping(stacks);
  if (open?.typing && open.typing.editor === run.editor) {
    const patches = compose(open.patches, draft.patches);
    const tip = run.kind === "input" ? patches : open.typing.tip;
    const step = withCids({ ...open, patches, typing: { ...open.typing, tip } }, env);
    const stack = stacks.byScope[open.scope];
    const undo = [...stack.undo.slice(0, -1), step];
    return { stacks: withStack(stacks, open.scope, { ...stack, undo }), dropped: [], step };
  }
  const typing = { editor: run.editor, textAtOpen: run.textAtOpen, tip: draft.patches };
  return record(stacks, { ...draft, typing, tag: null }, env, editor);
}

export type Action =
  | { readonly kind: "none" }
  /** Cancel a wait. */
  | { readonly kind: "cancel"; readonly wait: Wait }
  /** The open typing run's editor undoes or redoes one of its own steps. */
  | { readonly kind: "editor"; readonly step: Step }
  /** Write `side` of the step; it has moved to the other side. `gaveUp` names
   * the checked keys it no longer owned, which are gone from it. */
  | {
      readonly kind: "replay";
      readonly step: Step;
      readonly side: Side;
      readonly gaveUp: readonly string[];
    }
  /** A held step is released, never committed. */
  | { readonly kind: "release"; readonly step: Step };

/** What a press does, and the history after it. */
export interface Press extends Change {
  readonly action: Action;
}

const NONE: Action = { kind: "none" };

function inReach(scope: Scope, made: NavView, facts: Facts): boolean {
  const own = scopeOf(facts.view);
  if (!facts.recorded.has(own)) return made === facts.view;
  return scope === own || scope === "shared" || made === facts.view;
}

/** The step of a side's top a press may reach, per scope. */
function tops(stacks: Stacks, facts: Facts, side: "undo" | "redo"): Step[] {
  return SCOPES.flatMap((scope) => {
    const step = last(stacks.byScope[scope][side]);
    if (!step) return [];
    const reached =
      facts.only !== undefined ? step.id === facts.only : inReach(scope, step.view, facts);
    return reached ? [step] : [];
  });
}

/** Number the step's move, in place. */
function bump(stacks: Stacks, step: Step): Press {
  const moved = stacks.counter + 1;
  const stack = stacks.byScope[step.scope];
  const touchedStep = { ...step, moved };
  const undo = stack.undo.map((s) => (s.id === step.id ? touchedStep : s));
  const next = { ...withStack(stacks, step.scope, { ...stack, undo }), counter: moved };
  return { stacks: next, dropped: [], action: { kind: "editor", step: touchedStep } };
}

/** Move a side's top to the other side, after closing an open typing run. */
function move(
  stacks: Stacks,
  step: Step,
  from: "undo" | "redo",
  facts: Facts,
  env: Env,
  dropped: readonly Step[] = [],
): Press {
  const closed =
    openTyping(stacks)?.id === step.id ? null : closeOpen(stacks, true, facts.editor, env);
  const base = closed?.stacks ?? stacks;
  const stack = base.byScope[step.scope];
  if (last(stack[from])?.id !== step.id) return { stacks, dropped: [], action: NONE };
  const gone = [...dropped, ...(closed?.dropped ?? [])];
  // a checked key moves with the step only while the step owns it: on undo it
  // must be the key's last writer, on redo the key must be as the step found it
  const owner = (c: string) => base.owners[c] ?? 0;
  const gaveUp = checkedOf(step, env).filter((c) =>
    from === "undo" ? owner(c) !== step.id : owner(c) !== (step.under[c] ?? 0),
  );
  const lean = gaveUp.length > 0 ? withoutChecked(step, gaveUp, env) : step;
  if (gaveUp.length > 0 && isBare(lean)) {
    // nothing is left of it: the step goes and the press acts on what is next
    const without = withStack(base, step.scope, { ...stack, [from]: stack[from].slice(0, -1) });
    const next = (from === "undo" ? undo : redo)(
      { ...without, latest: null },
      { ...facts, editor: null },
      env,
    );
    return { ...next, dropped: [...gone, step, ...next.dropped] };
  }
  const kept = checkedOf(lean, env);
  const owners =
    kept.length > 0
      ? {
          ...base.owners,
          ...Object.fromEntries(
            kept.map((c) => [c, from === "undo" ? (lean.under[c] ?? 0) : lean.id]),
          ),
        }
      : base.owners;
  const moved = { ...lean, moved: base.counter + 1 };
  const next: Stack =
    from === "undo"
      ? { undo: stack.undo.slice(0, -1), redo: [...stack.redo, moved] }
      : { undo: [...stack.undo, moved], redo: stack.redo.slice(0, -1) };
  return {
    stacks: {
      ...withStack(base, step.scope, next),
      counter: moved.moved,
      latest: null,
      owners,
    },
    dropped: gone,
    action: { kind: "replay", step: moved, side: from === "undo" ? "before" : "after", gaveUp },
  };
}

/** What Undo does from `facts.view`: the newest step or wait in reach. */
export function undo(stacks: Stacks, facts: Facts, env: Env): Press {
  const steps = tops(stacks, facts, "undo");
  const waits =
    facts.only === undefined ? facts.waits.filter((w) => inReach(w.scope, w.view, facts)) : [];
  const step = steps.reduce<Step | null>((a, b) => (a && a.id > b.id ? a : b), null);
  const wait = waits.reduce<Wait | null>((a, b) => (a && a.id > b.id ? a : b), null);
  if (wait && (!step || wait.id > step.id)) {
    return { stacks, dropped: [], action: { kind: "cancel", wait } };
  }
  if (!step) return { stacks, dropped: [], action: NONE };
  if (step.typing && step.id === stacks.latest) {
    if (facts.editor?.canUndo) return bump(stacks, step);
    const closed = closeOpen(stacks, true, facts.editor, env);
    if (facts.editor?.atOpen) {
      // the run is empty: it goes, and the press acts on what is next
      const rest = undo(closed.stacks, { ...facts, editor: null }, env);
      if (rest.action.kind === "none") return { stacks, dropped: [], action: NONE };
      return { ...rest, dropped: [...closed.dropped, ...rest.dropped] };
    }
    const run = last(closed.stacks.byScope[step.scope].undo);
    if (!run) return { stacks, dropped: [], action: NONE };
    return move(closed.stacks, run, "undo", { ...facts, editor: null }, env, closed.dropped);
  }
  if (step.held) {
    const closed = closeOpen(stacks, true, facts.editor, env);
    const stack = closed.stacks.byScope[step.scope];
    const next = withStack(closed.stacks, step.scope, { ...stack, undo: stack.undo.slice(0, -1) });
    return {
      stacks: { ...next, latest: null },
      dropped: closed.dropped,
      action: { kind: "release", step },
    };
  }
  return move(stacks, step, "undo", facts, env);
}

/** What Redo does from `facts.view`: the redo top in reach moved last, or the
 * open typing run while its editor can redo. */
export function redo(stacks: Stacks, facts: Facts, env: Env): Press {
  const steps = tops(stacks, facts, "redo");
  const open = openTyping(stacks);
  const reachable =
    open &&
    (facts.only !== undefined ? open.id === facts.only : inReach(open.scope, open.view, facts));
  if (open && reachable && facts.editor?.canRedo) steps.push(open);
  const step = steps.reduce<Step | null>((a, b) => (a && a.moved > b.moved ? a : b), null);
  if (!step) return { stacks, dropped: [], action: NONE };
  if (step === open) return bump(stacks, step);
  return move(stacks, step, "redo", facts, env);
}

/** A follow-up write to one item of a list slice, from `from` to `to`. */
export interface ItemWrite {
  readonly scope: Scope;
  readonly slice: string;
  readonly id: string;
  readonly from: unknown;
  readonly to: unknown;
}

function itemOf(step: Step, write: ItemWrite) {
  const patch = step.patches.find((p) => p.slice === write.slice);
  return patch?.kind === "list" ? patch.items[write.id] : undefined;
}

function withItem(step: Step, write: ItemWrite, side: Side, env: Env): Step {
  const patches = step.patches.flatMap((patch): Patch[] => {
    const change =
      patch.kind === "list" && patch.slice === write.slice ? patch.items[write.id] : undefined;
    if (patch.kind !== "list" || !change) return [patch];
    const next = { ...change, [side]: write.to };
    const others = Object.entries(patch.items).filter(([id]) => id !== write.id);
    const items = Object.fromEntries(
      sameValue(next.before, next.after) ? others : [...others, [write.id, next]],
    );
    const out: ListPatch = { ...patch, items };
    return isEmpty(out) ? [] : [out];
  });
  return withCids({ ...step, patches }, env);
}

/** Follow-up writes join the steps they belong to: per item, the newest
 * undo-side step that touches it takes `to` as its after when that after is
 * `from` itself, and the nearest redo-side step that touches it takes `to` as
 * its before likewise. A step left changing nothing goes. */
export function join(stacks: Stacks, writes: readonly ItemWrite[], env: Env): Change {
  let current = stacks;
  const dropped: Step[] = [];
  for (const write of writes) {
    const stack = current.byScope[write.scope];
    const undoSide = [...stack.undo];
    const redoSide = [...stack.redo];
    for (let i = undoSide.length - 1; i >= 0; i--) {
      const change = itemOf(undoSide[i], write);
      if (!change) continue;
      if (Object.is(change.after, write.from))
        undoSide[i] = withItem(undoSide[i], write, "after", env);
      break;
    }
    for (let i = redoSide.length - 1; i >= 0; i--) {
      const change = itemOf(redoSide[i], write);
      if (!change) continue;
      if (Object.is(change.before, write.from))
        redoSide[i] = withItem(redoSide[i], write, "before", env);
      break;
    }
    const keep = (step: Step) => !isBare(step) || step.typing !== null;
    dropped.push(...undoSide.filter((s) => !keep(s)), ...redoSide.filter((s) => !keep(s)));
    const next = { undo: undoSide.filter(keep), redo: redoSide.filter(keep) };
    current = withStack(current, write.scope, next);
  }
  return { stacks: withLatest(current), dropped };
}

/** `latest` cleared when its step is gone or moved. */
function withLatest(stacks: Stacks): Stacks {
  if (stacks.latest === null) return stacks;
  const live = SCOPES.some((scope) => last(stacks.byScope[scope].undo)?.id === stacks.latest);
  return live ? stacks : { ...stacks, latest: null };
}

function lastIndex<T>(items: readonly T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i])) return i;
  return -1;
}

const names = (step: Step, cids: ReadonlySet<string>) =>
  [...step.cids.keys()].some((cid) => cids.has(cid));

/** Bytes deleted for good: per stack the newest undo-side step naming one goes
 * with every older step, and the redo-side step nearest to now naming one with
 * every later one. */
export function cut(stacks: Stacks, cids: ReadonlySet<string>): Change {
  let current = stacks;
  const dropped: Step[] = [];
  for (const scope of SCOPES) {
    const stack = current.byScope[scope];
    const u = lastIndex(stack.undo, (step) => names(step, cids));
    const r = lastIndex(stack.redo, (step) => names(step, cids));
    if (u < 0 && r < 0) continue;
    dropped.push(...stack.undo.slice(0, u + 1), ...stack.redo.slice(0, r + 1));
    current = withStack(current, scope, {
      undo: stack.undo.slice(u + 1),
      redo: stack.redo.slice(r + 1),
    });
  }
  return { stacks: withLatest(current), dropped };
}

/** Server items gone for good: commands that need one go, and a step left
 * with nothing to do goes. */
export function invalidate(stacks: Stacks, tags: ReadonlySet<string>): Change {
  let current = stacks;
  const dropped: Step[] = [];
  const needs = (command: Step["commands"][number]) => command.tags.some((tag) => tags.has(tag));
  for (const scope of SCOPES) {
    const stack = current.byScope[scope];
    if (![...stack.undo, ...stack.redo].some((step) => step.commands.some(needs))) continue;
    const prune = (side: readonly Step[]) =>
      side.flatMap((step) => {
        if (!step.commands.some(needs)) return [step];
        const kept = { ...step, commands: step.commands.filter((c) => !needs(c)) };
        if (isBare(kept)) {
          dropped.push(step);
          return [];
        }
        return [kept];
      });
    current = withStack(current, scope, { undo: prune(stack.undo), redo: prune(stack.redo) });
  }
  return { stacks: withLatest(current), dropped };
}

/** Every step of a scope goes: the document was replaced. */
export function clear(stacks: Stacks, scope: Scope): Change {
  const stack = stacks.byScope[scope];
  return {
    stacks: withLatest(withStack(stacks, scope, EMPTY)),
    dropped: [...stack.undo, ...stack.redo],
  };
}

/** One step goes, wherever it is: a held step committed or released by its notice. */
export function remove(stacks: Stacks, id: number): Change {
  for (const scope of SCOPES) {
    const stack = stacks.byScope[scope];
    const step = [...stack.undo, ...stack.redo].find((s) => s.id === id);
    if (!step) continue;
    const without = (side: readonly Step[]) => side.filter((s) => s.id !== id);
    const next = withStack(stacks, scope, { undo: without(stack.undo), redo: without(stack.redo) });
    return { stacks: withLatest(next), dropped: [step] };
  }
  return { stacks, dropped: [] };
}
