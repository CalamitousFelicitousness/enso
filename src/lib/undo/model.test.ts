// Model-based test of the undo core. The reference model below is written
// from the rules of the design, over whole cells of a small document, and
// shares no code with the core: it diffs by JSON, keeps before and after per
// changed cell, and replays cell by cell. Every command runs on both, and the
// documents and stacks must agree after each one.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { NavView } from "@/lib/constants";
import { evict, undoBytes } from "./budget";
import { applyList, cell, diffKeys, diffList } from "./patch";
import {
  allSteps,
  clear,
  closeTyping,
  cut,
  emptyStacks,
  holds,
  join,
  openTyping,
  record,
  recordTyping,
  redo,
  remove,
  reserve,
  touch,
  undo,
} from "./stacks";
import {
  SCOPES,
  type Draft,
  type EditorFacts,
  type Env,
  type Patch,
  type Scope,
  type Side,
  type Stacks,
  type Step,
  type Wait,
} from "./types";

const LIMIT = 5;
const RECORDED: ReadonlySet<Scope> = new Set<Scope>(["images", "gallery", "shared"]);
const VIEWS: readonly NavView[] = ["images", "gallery", "video"];
const IDS = ["a", "b", "c"] as const;
const PROMPT = "settings.prompt";
const MODEL = "model.activeModel";
const ORDER = "inputs#order";

interface Item {
  readonly id: string;
  readonly v: number;
  readonly cids: Readonly<Record<string, number>>;
}

type Cells = Record<string, unknown>;
type Write = readonly [cell: string, value: unknown];

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const scopeOfCell = (cell: string): Scope =>
  cell.startsWith("inputs") || cell.startsWith("settings")
    ? "images"
    : cell.startsWith("files")
      ? "gallery"
      : "shared";
function lastIdx<T>(items: readonly T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i])) return i;
  return -1;
}
const itemCids = (value: unknown): string[] =>
  typeof value === "object" && value !== null && "cids" in value
    ? Object.keys((value as Item).cids)
    : [];

// ── The reference model ────────────────────────────────────────────────

type Kind = "step" | "typing" | "held";

interface Entry {
  id: number;
  moved: number;
  scope: Scope;
  view: NavView;
  kind: Kind;
  before: Cells;
  after: Cells;
  textAtOpen?: string;
  tip?: string;
  tag?: object;
  /** Who had written the checked key last when this step wrote it. */
  under?: number;
}

type ModelAction = "none" | "cancel" | "editor" | "replay" | "release";

class Model {
  doc: Cells = {
    "inputs#a": null,
    "inputs#b": null,
    "inputs#c": null,
    [ORDER]: [],
    "settings.steps": 0,
    [PROMPT]: "",
    "files.n": 0,
    [MODEL]: "m0",
    "presets.p": 0,
  };
  stacks = Object.fromEntries(SCOPES.map((s) => [s, { undo: [], redo: [] }])) as unknown as Record<
    Scope,
    { undo: Entry[]; redo: Entry[] }
  >;
  counter = 0;
  /** Who wrote the checked key last: an entry's id, or a number of its own
   * for a write no step made. */
  lastWriter = 0;
  latest: number | null = null;
  waits: Wait[] = [];

  clone(): Model {
    const m = new Model();
    m.doc = { ...this.doc };
    const copy = (e: Entry): Entry => ({ ...e, before: { ...e.before }, after: { ...e.after } });
    for (const s of SCOPES) {
      m.stacks[s] = { undo: this.stacks[s].undo.map(copy), redo: this.stacks[s].redo.map(copy) };
    }
    m.counter = this.counter;
    m.lastWriter = this.lastWriter;
    m.latest = this.latest;
    m.waits = [...this.waits];
    return m;
  }

  open(): Entry | null {
    for (const s of SCOPES) {
      const top = this.stacks[s].undo.at(-1);
      if (top && top.id === this.latest) return top.kind === "typing" ? top : null;
    }
    return null;
  }

  private limit(scope: Scope) {
    const stack = this.stacks[scope];
    while (stack.undo.length + stack.redo.length > LIMIT && stack.undo.length > 0) {
      const gone = stack.undo.shift();
      if (gone?.id === this.latest) this.latest = null;
    }
  }

  /** A typing run closes: gone when its text is back where it began; what the
   * editor stepped back from goes to the redo side unless a new step in its
   * own stack caused the close. */
  close(run: Entry, remainder: boolean) {
    const text = this.doc[PROMPT] as string;
    const stack = this.stacks[run.scope];
    if (remainder && run.tip !== text) {
      const id = ++this.counter;
      stack.redo.push({
        id,
        moved: id,
        scope: run.scope,
        view: run.view,
        kind: "step",
        before: { [PROMPT]: text },
        after: { [PROMPT]: run.tip },
      });
    }
    if (text === run.textAtOpen) stack.undo.splice(stack.undo.indexOf(run), 1);
    else run.kind = "step";
    this.latest = null;
    this.limit(run.scope);
  }

  /** A recorded change: its own stack's redo side goes, an open run closes. */
  record(scope: Scope, view: NavView, writes: readonly Write[], kind: Kind = "step"): Entry | null {
    const changed = writes.filter(([cell, value]) => !eq(this.doc[cell], value));
    if (changed.length === 0 && kind !== "held") return null;
    const run = this.open();
    if (run) this.close(run, run.scope !== scope);
    const entry: Entry = { id: ++this.counter, moved: 0, scope, view, kind, before: {}, after: {} };
    entry.moved = entry.id;
    for (const [cell, value] of changed) {
      entry.before[cell] = this.doc[cell];
      entry.after[cell] = value;
      this.doc[cell] = value;
    }
    if (MODEL in entry.before) {
      entry.under = this.lastWriter;
      this.lastWriter = entry.id;
    }
    this.stacks[scope].undo.push(entry);
    this.stacks[scope].redo = [];
    this.latest = entry.id;
    this.limit(scope);
    return entry;
  }

  type(view: NavView, text: string) {
    const run = this.open();
    if (run) {
      run.after = { [PROMPT]: text };
      run.tip = text;
      this.doc[PROMPT] = text;
      return;
    }
    const before = this.doc[PROMPT] as string;
    const entry = this.record("images", view, [[PROMPT, text]], "typing");
    if (entry) Object.assign(entry, { textAtOpen: before, tip: text });
  }

  /** A native text field's change extends the latest step when that step came
   * from the same field and holds the same cell; typed back to its start, the
   * step goes. */
  field(view: NavView, cell: string, value: unknown, tag: object) {
    if (eq(this.doc[cell], value)) return;
    const scope = scopeOfCell(cell);
    const stack = this.stacks[scope];
    const prev = stack.undo.at(-1);
    const same = prev?.id === this.latest && prev.tag === tag;
    if (prev && same && Object.keys(prev.before).join() === cell) {
      prev.after[cell] = value;
      this.doc[cell] = value;
      if (!eq(prev.before[cell], value)) return;
      stack.undo.pop();
      this.latest = null;
      return;
    }
    const entry = this.record(scope, view, [[cell, value]]);
    if (entry) entry.tag = tag;
  }

  /** A document replaced from storage: its stack goes whole. */
  clear(scope: Scope) {
    this.stacks[scope] = { undo: [], redo: [] };
    if (this.latest !== null && !SCOPES.some((s) => this.stacks[s].undo.at(-1)?.id === this.latest))
      this.latest = null;
  }

  /** The editor undid or redid one of its own steps inside the open run. */
  editorMoved(text: string) {
    const run = this.open();
    if (!run) throw new Error("model: no open run");
    run.after = { [PROMPT]: text };
    this.doc[PROMPT] = text;
  }

  inReach(scope: Scope, made: NavView, view: NavView): boolean {
    if (!RECORDED.has(view)) return made === view;
    return scope === view || scope === "shared" || made === view;
  }

  /** A write to the checked key that no step made: no step owns it now. */
  external() {
    this.lastWriter = ++this.counter;
  }

  /** The checked key moves with a step only while the step owns it: to undo
   * it, the step must be the last to have written it; to redo it, the key
   * must be as the step found it. Otherwise the step gives the key up for
   * good. True when nothing is left of the step. */
  private givesUp(entry: Entry, side: Side): boolean {
    if (!(MODEL in entry.before)) return false;
    const owns = side === "before" ? this.lastWriter === entry.id : this.lastWriter === entry.under;
    if (owns) return false;
    delete entry.before[MODEL];
    delete entry.after[MODEL];
    delete entry.under;
    return Object.keys(entry.before).length === 0 && entry.kind === "step";
  }

  private write(entry: Entry, side: Side) {
    for (const [cell, value] of Object.entries(entry[side])) this.doc[cell] = value;
    if (MODEL in entry.before) this.lastWriter = (side === "before" ? entry.under : entry.id) ?? 0;
  }

  private moveToRedo(entry: Entry, view: NavView): ModelAction {
    const stack = this.stacks[entry.scope];
    if (this.givesUp(entry, "before")) {
      // nothing is left of it: it goes, and the press acts on what is next
      stack.undo.splice(stack.undo.indexOf(entry), 1);
      this.latest = null;
      return this.undo(view, null);
    }
    this.write(entry, "before");
    stack.undo.splice(stack.undo.indexOf(entry), 1);
    entry.moved = ++this.counter;
    stack.redo.push(entry);
    this.latest = null;
    return "replay";
  }

  undo(view: NavView, editor: EditorFacts | null): ModelAction {
    const tops = SCOPES.flatMap((s) => {
      const top = this.stacks[s].undo.at(-1);
      return top && this.inReach(s, top.view, view) ? [top] : [];
    });
    const entry = tops.reduce<Entry | null>((a, b) => (a && a.id > b.id ? a : b), null);
    const wait = this.waits
      .filter((w) => this.inReach(w.scope, w.view, view))
      .reduce<Wait | null>((a, b) => (a && a.id > b.id ? a : b), null);
    if (wait && (!entry || wait.id > entry.id)) {
      this.waits = this.waits.filter((w) => w !== wait);
      return "cancel";
    }
    if (!entry) return "none";
    if (entry.kind === "typing" && entry.id === this.latest) {
      if (editor?.canUndo) {
        entry.moved = ++this.counter;
        return "editor";
      }
      if (this.doc[PROMPT] === entry.textAtOpen) {
        // an empty run goes and the press acts on what is next; with nothing
        // next the press does nothing and the run stays open
        const trial = this.clone();
        const run = trial.open();
        if (!run) throw new Error("model: lost the run");
        trial.close(run, true);
        const rest = trial.undo(view, null);
        if (rest === "none") return "none";
        Object.assign(this, trial);
        return rest;
      }
      this.close(entry, true);
      return this.moveToRedo(entry, view);
    }
    const run = this.open();
    if (run) this.close(run, true);
    if (entry.kind === "held") {
      const stack = this.stacks[entry.scope];
      stack.undo.splice(stack.undo.indexOf(entry), 1);
      this.latest = null;
      return "release";
    }
    return this.moveToRedo(entry, view);
  }

  redo(view: NavView, editor: EditorFacts | null): ModelAction {
    const tops = SCOPES.flatMap((s) => {
      const top = this.stacks[s].redo.at(-1);
      return top && this.inReach(s, top.view, view) ? [top] : [];
    });
    const run = this.open();
    if (run && editor?.canRedo && this.inReach(run.scope, run.view, view)) tops.push(run);
    const entry = tops.reduce<Entry | null>((a, b) => (a && a.moved > b.moved ? a : b), null);
    if (!entry) return "none";
    if (entry === run) {
      entry.moved = ++this.counter;
      return "editor";
    }
    if (run) this.close(run, true);
    const stack = this.stacks[entry.scope];
    if (this.givesUp(entry, "after")) {
      stack.redo.splice(stack.redo.indexOf(entry), 1);
      this.latest = null;
      return this.redo(view, null);
    }
    this.write(entry, "after");
    stack.redo.splice(stack.redo.indexOf(entry), 1);
    entry.moved = ++this.counter;
    stack.undo.push(entry);
    this.latest = null;
    return "replay";
  }

  /** A follow-up write to an item joins the newest undo-side step that
   * touches it when that step's after is the item written over, and moves the
   * before of the nearest redo-side step that touches it likewise. */
  follow(cell: string, to: unknown) {
    const from = this.doc[cell];
    this.doc[cell] = to;
    const stack = this.stacks[scopeOfCell(cell)];
    const fix = (side: Entry[], end: "before" | "after") => {
      const entry = side[lastIdx(side, (e) => cell in e.before)];
      if (!entry || entry[end][cell] !== from) return;
      entry[end][cell] = to;
      if (eq(entry.before[cell], entry.after[cell])) {
        delete entry.before[cell];
        delete entry.after[cell];
      }
      if (Object.keys(entry.before).length === 0 && entry.kind === "step") {
        side.splice(side.indexOf(entry), 1);
        if (entry.id === this.latest) this.latest = null;
      }
    };
    fix(stack.undo, "after");
    fix(stack.redo, "before");
  }

  names(entry: Entry): string[] {
    return [...Object.values(entry.before), ...Object.values(entry.after)].flatMap(itemCids);
  }

  /** Bytes gone for good: the newest undo-side step naming one goes with every
   * older step; the redo-side step nearest to now with every later one. */
  cut(cids: ReadonlySet<string>) {
    for (const s of SCOPES) {
      const stack = this.stacks[s];
      const hit = (e: Entry) => this.names(e).some((cid) => cids.has(cid));
      stack.undo = stack.undo.slice(lastIdx(stack.undo, hit) + 1);
      stack.redo = stack.redo.slice(lastIdx(stack.redo, hit) + 1);
    }
    if (this.latest !== null && !SCOPES.some((s) => this.stacks[s].undo.at(-1)?.id === this.latest))
      this.latest = null;
  }

  /** No unrecorded write sits on a cell a step holds: every such cell is at
   * the after of the newest undo-side step that changed it. */
  clean(): boolean {
    const newest: Record<string, Entry> = {};
    for (const s of SCOPES) {
      for (const e of this.stacks[s].undo) {
        for (const cell of Object.keys(e.before)) {
          if (cell === MODEL) continue;
          if (!newest[cell] || newest[cell].id < e.id) newest[cell] = e;
        }
      }
    }
    return Object.entries(newest).every(([cell, e]) => eq(e.after[cell], this.doc[cell]));
  }

  removeAt(scope: Scope, side: "undo" | "redo", index: number) {
    const [gone] = this.stacks[scope][side].splice(index, 1);
    if (gone?.id === this.latest) this.latest = null;
  }
}

// ── The core under test, driven the way the runtime will drive it ──────

interface Doc {
  readonly inputs: readonly Item[];
  readonly settings: { readonly steps: number; readonly prompt: string };
  readonly files: { readonly n: number };
  readonly model: { readonly activeModel: string };
  readonly presets: { readonly p: number };
}

const DOC0: Doc = {
  inputs: [],
  settings: { steps: 0, prompt: "" },
  files: { n: 0 },
  model: { activeModel: "m0" },
  presets: { p: 0 },
};

const sized = (value: unknown): [string, number][] =>
  typeof value === "object" && value !== null && "cids" in value
    ? Object.entries((value as Item).cids)
    : [];

const env: Env = {
  cidsOf: (patch) =>
    patch.kind === "list"
      ? Object.values(patch.items).flatMap((c) => [...sized(c.before), ...sized(c.after)])
      : [],
  stepLimit: LIMIT,
  checked: new Set([cell("model", "activeModel")]),
};

function cellsOfDoc(doc: Doc): Cells {
  const out: Cells = {};
  for (const id of IDS) out[`inputs#${id}`] = doc.inputs.find((i) => i.id === id) ?? null;
  out[ORDER] = doc.inputs.map((i) => i.id);
  out["settings.steps"] = doc.settings.steps;
  out[PROMPT] = doc.settings.prompt;
  out["files.n"] = doc.files.n;
  out[MODEL] = doc.model.activeModel;
  out["presets.p"] = doc.presets.p;
  return out;
}

function withWrites(doc: Doc, writes: readonly Write[]): Doc {
  const cells = { ...cellsOfDoc(doc), ...Object.fromEntries(writes) };
  return {
    inputs: (cells[ORDER] as string[]).map((id) => cells[`inputs#${id}`] as Item),
    settings: { steps: cells["settings.steps"] as number, prompt: cells[PROMPT] as string },
    files: { n: cells["files.n"] as number },
    model: { activeModel: cells[MODEL] as string },
    presets: { p: cells["presets.p"] as number },
  };
}

const idOf = (item: Item) => item.id;
const present = (patches: (Patch | null)[]): Patch[] => patches.filter((p) => p !== null);

/** The step a change makes: the document scope's slices, with the checked
 * model key riding on them; a change to shared slices alone is a shared step. */
function draftFor(old: Doc, next: Doc, view: NavView, more: Partial<Draft> = {}): Draft | null {
  const images = present([
    diffList("inputs", { items: old.inputs, keys: {} }, { items: next.inputs, keys: {} }, idOf, []),
    diffKeys("settings", old.settings, next.settings, ["steps", "prompt"]),
  ]);
  const gallery = present([diffKeys("files", old.files, next.files, ["n"])]);
  const model = present([diffKeys("model", old.model, next.model, ["activeModel"])]);
  const presets = present([diffKeys("presets", old.presets, next.presets, ["p"])]);
  const base = { view, at: 0, name: { kind: "test" }, context: null, commands: [], typing: null };
  const rest = { tag: null, held: null, ...more };
  if (images.length > 0)
    return { ...base, ...rest, scope: "images", patches: images, riders: model };
  if (gallery.length > 0)
    return { ...base, ...rest, scope: "gallery", patches: gallery, riders: model };
  const shared = [...model, ...presets];
  if (shared.length === 0 && rest.held === null) return null;
  return { ...base, ...rest, scope: "shared", patches: shared, riders: [] };
}

/** A step's side written to the document. */
function replay(doc: Doc, step: Step, side: Side): Doc {
  let out = doc;
  for (const patch of [...step.patches, ...step.riders]) {
    if (patch.kind === "list") {
      const next = applyList({ items: out.inputs, keys: {} }, patch, side, idOf);
      out = { ...out, inputs: next.items };
    } else {
      const slice = patch.slice as "settings" | "files" | "model" | "presets";
      out = { ...out, [slice]: { ...out[slice], ...patch[side] } };
    }
  }
  return out;
}

function cellsOfPatches(patches: readonly Patch[]): { before: Cells; after: Cells } {
  const before: Cells = {};
  const after: Cells = {};
  for (const p of patches) {
    if (p.kind === "keys") {
      for (const key of Object.keys(p.before)) {
        before[`${p.slice}.${key}`] = p.before[key];
        after[`${p.slice}.${key}`] = p.after[key];
      }
      continue;
    }
    for (const [id, change] of Object.entries(p.items)) {
      before[`${p.slice}#${id}`] = change.before;
      after[`${p.slice}#${id}`] = change.after;
    }
    if (p.order) {
      before[ORDER] = p.order.before;
      after[ORDER] = p.order.after;
    }
  }
  return { before, after };
}

const kindOf = (step: Step): Kind => (step.held ? "held" : step.typing ? "typing" : "step");

function shapeOfStep(step: Step) {
  const tip = step.typing
    ? ((cellsOfPatches(step.typing.tip).after[PROMPT] as string | undefined) ??
      step.typing.textAtOpen)
    : undefined;
  return {
    view: step.view,
    kind: kindOf(step),
    tip,
    ...cellsOfPatches([...step.patches, ...step.riders]),
  };
}

function shapeOfEntry(entry: Entry) {
  const cells = Object.keys(entry.before).filter((c) => !eq(entry.before[c], entry.after[c]));
  return {
    view: entry.view,
    kind: entry.kind,
    tip: entry.kind === "typing" ? entry.tip : undefined,
    before: Object.fromEntries(cells.map((c) => [c, entry.before[c]])),
    after: Object.fromEntries(cells.map((c) => [c, entry.after[c]])),
  };
}

const SIDES = ["undo", "redo"] as const;

/** What must hold of the core's stacks whatever was done to them. */
function invariants(stacks: Stacks) {
  for (const scope of SCOPES) {
    const { undo: u, redo: r } = stacks.byScope[scope];
    expect(u.length + r.length, `step limit of ${scope}`).toBeLessThanOrEqual(LIMIT);
    for (let i = 1; i < u.length; i++)
      expect(u[i].id, "undo side by id").toBeGreaterThan(u[i - 1].id);
  }
  const typing = allSteps(stacks).filter((step) => step.typing !== null);
  expect(typing.length, "typing runs").toBeLessThanOrEqual(1);
  expect(typing[0]?.id).toBe(openTyping(stacks)?.id);
  const held = holds(stacks);
  for (const step of allSteps(stacks)) {
    const named = [...step.patches, ...step.riders, ...(step.typing?.tip ?? [])];
    const cids = new Map(named.flatMap((patch) => [...env.cidsOf(patch)]));
    expect([...step.cids.keys()].sort(), "cids of a step").toEqual([...cids.keys()].sort());
    for (const cid of cids.keys()) expect(held.has(cid), `holds ${cid}`).toBe(true);
  }
}

const EDITOR = {};
const FIELDS = [{}, {}];

type Op =
  | { t: "change"; what: string; n: number; id: string }
  | { t: "undo" | "redo" | "hide" | "hold" | "lock" | "forget" | "type" | "trip" }
  | { t: "view"; view: NavView }
  | { t: "ignore"; what: string; n: number; id: string }
  | { t: "follow"; id: string }
  | { t: "cut"; cids: string[] }
  | { t: "commit" | "land"; k: number; n: number }
  | { t: "wait"; view: NavView }
  | { t: "evict"; budget: number }
  | { t: "field"; which: number; n: number }
  | { t: "clear"; scope: Scope };

/** The core and the reference model side by side, with the world they share:
 * the view, the waits and one prompt editor with a history of its own. */
class Rig {
  stacks: Stacks = emptyStacks();
  doc: Doc = DOC0;
  model = new Model();
  view: NavView = "images";
  waits: Wait[] = [];
  editor = { text: "", past: [] as string[], future: [] as string[], readOnly: false };
  textAtOpen = "";
  fresh = 0;

  clone(): Rig {
    const rig = new Rig();
    Object.assign(rig, this, {
      model: this.model.clone(),
      waits: [...this.waits],
      editor: { ...this.editor, past: [...this.editor.past], future: [...this.editor.future] },
    });
    return rig;
  }

  private facts(at: string | null): EditorFacts | null {
    if (at === null) return null;
    const { past, future, readOnly, text } = this.editor;
    return {
      canUndo: !readOnly && past.length > 0,
      canRedo: !readOnly && future.length > 0,
      atOpen: text === at,
    };
  }
  private coreEditor() {
    return this.facts(openTyping(this.stacks) ? this.textAtOpen : null);
  }
  private modelEditor() {
    return this.facts(this.model.open()?.textAtOpen ?? null);
  }

  private item(id: string, n: number): Item {
    return { id, v: ++this.fresh, cids: n === 0 ? {} : { [`c${n - 1}`]: 10 * n } };
  }

  private writesFor(what: string, n: number, id: string): Write[] {
    const order = this.doc.inputs.map(idOf);
    const has = order.includes(id);
    switch (what) {
      case "steps":
        return [["settings.steps", n]];
      case "files":
        return [["files.n", n]];
      case "preset":
        return [["presets.p", n]];
      case "model":
        return [[MODEL, `m${n}`]];
      case "stepsWithModel":
        return [
          ["settings.steps", n],
          [MODEL, `m${(n + 1) % 3}`],
        ];
      case "prompt":
        return [[PROMPT, `p${n}`]];
      case "edit":
        return has ? [[`inputs#${id}`, this.item(id, n)]] : [];
      case "add":
        return has
          ? []
          : [
              [`inputs#${id}`, this.item(id, n)],
              [ORDER, [...order, id]],
            ];
      case "remove":
        return has
          ? [
              [`inputs#${id}`, null],
              [ORDER, order.filter((x) => x !== id)],
            ]
          : [];
      default:
        return order.length > 1 ? [[ORDER, [...order.slice(1), order[0]]]] : [];
    }
  }

  private change(writes: readonly Write[], view: NavView, more: Partial<Draft> = {}) {
    const changed = writes.filter(([cell, value]) => !eq(this.model.doc[cell], value));
    const scopes = new Set(changed.map(([cell]) => scopeOfCell(cell)));
    const scope = scopes.has("images") ? "images" : scopes.has("gallery") ? "gallery" : "shared";
    this.model.record(scope, view, changed, more.held ? "held" : "step");
    const next = withWrites(this.doc, writes);
    const draft = draftFor(this.doc, next, view, more);
    if (draft) this.stacks = record(this.stacks, draft, env, this.coreEditor()).stacks;
    this.doc = next;
  }

  private typed(text: string, kind: "input" | "undo" | "redo") {
    const next = withWrites(this.doc, [[PROMPT, text]]);
    const draft = draftFor(this.doc, next, this.view);
    if (!draft) throw new Error("typing changed nothing");
    const run = { editor: EDITOR, textAtOpen: this.textAtOpen, kind };
    this.stacks = recordTyping(this.stacks, draft, run, env, this.coreEditor()).stacks;
    this.doc = next;
  }

  press(dir: "undo" | "redo"): string {
    const expected = this.model[dir](this.view, this.modelEditor());
    const facts = {
      view: this.view,
      waits: this.waits,
      recorded: RECORDED,
      editor: this.coreEditor(),
    };
    const result = (dir === "undo" ? undo : redo)(this.stacks, facts, env);
    const action = result.action;
    expect(action.kind, `what ${dir} does`).toBe(expected);
    this.stacks = result.stacks;
    if (action.kind === "cancel") this.waits = this.waits.filter((w) => w.id !== action.wait.id);
    if (action.kind === "replay") this.doc = replay(this.doc, action.step, action.side);
    if (action.kind === "editor") {
      const { past, future, text } = this.editor;
      const [from, to] = dir === "undo" ? [past, future] : [future, past];
      to.push(text);
      this.editor.text = from.pop() ?? text;
      this.model.editorMoved(this.editor.text);
      this.typed(this.editor.text, dir);
    }
    return action.kind;
  }

  apply(op: Op) {
    const before = this.stacks.byScope;
    switch (op.t) {
      case "change":
        this.change(this.writesFor(op.what, op.n, op.id), this.view);
        break;
      case "undo":
      case "redo":
        this.press(op.t);
        break;
      case "view":
        this.view = op.view;
        break;
      case "ignore": {
        const writes = this.writesFor(op.what, op.n, op.id);
        const outside = writes.some(([c, value]) => c === MODEL && !eq(this.model.doc[c], value));
        for (const [c, value] of writes) this.model.doc[c] = value;
        this.doc = withWrites(this.doc, writes);
        if (outside) {
          this.model.external();
          this.stacks = touch(this.stacks, [cell("model", "activeModel")]);
        }
        break;
      }
      case "follow": {
        const from = this.doc.inputs.find((i) => i.id === op.id);
        if (!from) break;
        const to = { ...from, v: ++this.fresh, cids: { ...from.cids, k: 7 } };
        this.model.follow(`inputs#${op.id}`, to);
        const write = { scope: "images" as const, slice: "inputs", id: op.id, from, to };
        this.stacks = join(this.stacks, [write], env).stacks;
        this.doc = { ...this.doc, inputs: this.doc.inputs.map((i) => (i === from ? to : i)) };
        break;
      }
      case "type": {
        if (this.view !== "images" || this.editor.readOnly) break;
        const text = `${this.editor.text}x`;
        if (!openTyping(this.stacks)) this.textAtOpen = this.editor.text;
        this.editor.past.push(this.editor.text);
        this.editor.future = [];
        this.editor.text = text;
        this.model.type(this.view, text);
        this.typed(text, "input");
        break;
      }
      case "lock":
        this.editor.readOnly = !this.editor.readOnly;
        break;
      case "forget":
        this.editor.past = [];
        break;
      case "hide": {
        const run = this.model.open();
        if (run) this.model.close(run, true);
        this.stacks = closeTyping(this.stacks, this.coreEditor(), env).stacks;
        break;
      }
      case "cut": {
        const cids = new Set(op.cids);
        this.model.cut(cids);
        this.stacks = cut(this.stacks, cids).stacks;
        for (const cid of holds(this.stacks)) expect(cids.has(cid), `cut left ${cid}`).toBe(false);
        break;
      }
      case "hold":
        this.change([], this.view, { held: { undo: () => {}, commit: () => {}, until: 0 } });
        break;
      case "commit": {
        const held = this.stacks.byScope.shared.undo.filter((s) => s.held);
        if (held.length === 0) break;
        const step = held[op.k % held.length];
        const index = this.stacks.byScope.shared.undo.indexOf(step);
        this.model.removeAt("shared", "undo", index);
        this.stacks = remove(this.stacks, step.id).stacks;
        break;
      }
      case "wait": {
        const reserved = reserve(this.stacks);
        this.stacks = reserved.stacks;
        this.waits = [...this.waits, { id: reserved.id, scope: "images", view: op.view }];
        this.model.waits.push({ id: ++this.model.counter, scope: "images", view: op.view });
        break;
      }
      case "land": {
        if (this.waits.length === 0) break;
        const index = op.k % this.waits.length;
        const wait = this.waits[index];
        this.waits = this.waits.filter((w) => w !== wait);
        this.model.waits.splice(index, 1);
        this.change([["settings.steps", op.n]], wait.view);
        break;
      }
      case "evict":
        this.evict(op.budget);
        break;
      case "field": {
        const cell = op.which ? "presets.p" : "settings.steps";
        const tag = FIELDS[op.which];
        this.model.field(this.view, cell, op.n, tag);
        const next = withWrites(this.doc, [[cell, op.n]]);
        const draft = draftFor(this.doc, next, this.view, { tag });
        if (draft) this.stacks = record(this.stacks, draft, env, this.coreEditor()).stacks;
        this.doc = next;
        break;
      }
      case "clear":
        this.model.clear(op.scope);
        this.stacks = clear(this.stacks, op.scope).stacks;
        break;
      case "trip":
        this.roundTrip();
        break;
    }
    // what never touches a stack
    if (["view", "ignore", "lock", "forget", "wait", "trip"].includes(op.t))
      expect(this.stacks.byScope, `${op.t} left the stacks alone`).toBe(before);
    // a redo side loses steps only to a step recorded in its own stack or a press
    if (["change", "type", "hold", "land", "follow", "hide", "commit", "field"].includes(op.t)) {
      const lost = SCOPES.filter((s) => {
        const now = new Set(this.stacks.byScope[s].redo.map((step) => step.id));
        return before[s].redo.some((step) => !now.has(step.id));
      });
      expect(lost.length, "redo sides that lost steps").toBeLessThanOrEqual(1);
      for (const s of lost) expect(this.stacks.byScope[s].undo.at(-1)?.id).toBe(this.stacks.latest);
    }
    this.settle();
    this.check();
  }

  /** The editor follows the document, and keeps a history only while its run is open. */
  settle() {
    this.editor.text = this.doc.settings.prompt;
    if (openTyping(this.stacks)) return;
    this.editor.past = [];
    this.editor.future = [];
  }

  check() {
    expect(cellsOfDoc(this.doc), "the document").toEqual(this.model.doc);
    const places = (waits: readonly Wait[]) => waits.map((w) => `${w.scope}/${w.view}`);
    expect(places(this.waits)).toEqual(places(this.model.waits));
    expect(openTyping(this.stacks) !== null, "a typing run is open").toBe(
      this.model.open() !== null,
    );
    for (const scope of SCOPES) {
      for (const side of SIDES) {
        const real = this.stacks.byScope[scope][side].map(shapeOfStep);
        expect(real, `${side} side of ${scope}`).toEqual(
          this.model.stacks[scope][side].map(shapeOfEntry),
        );
      }
    }
    // the next press picks by these orders
    const ranked = <T>(tops: (scope: Scope) => T | undefined, key: (top: T) => number) =>
      SCOPES.flatMap((s) => {
        const top = tops(s);
        return top === undefined ? [] : [{ s, rank: key(top) }];
      })
        .sort((x, y) => x.rank - y.rank)
        .map((x) => x.s);
    expect(
      ranked(
        (s) => this.stacks.byScope[s].undo.at(-1),
        (t) => t.id,
      ),
    ).toEqual(
      ranked(
        (s) => this.model.stacks[s].undo.at(-1),
        (t) => t.id,
      ),
    );
    expect(
      ranked(
        (s) => this.stacks.byScope[s].redo.at(-1),
        (t) => t.moved,
      ),
    ).toEqual(
      ranked(
        (s) => this.model.stacks[s].redo.at(-1),
        (t) => t.moved,
      ),
    );
    invariants(this.stacks);
  }

  /** Eviction is checked by its rule: only runs from a side's far end, never
   * its top, each freeing bytes, and it stops only under the budget or when no
   * run frees any. The model then drops what the core dropped. */
  private evict(budget: number) {
    const named = new Set(this.doc.inputs.flatMap((i) => Object.keys(i.cids)));
    const was = this.stacks;
    const result = evict(was, named, budget);
    this.stacks = result.stacks;
    for (const scope of SCOPES) {
      for (const side of SIDES) {
        const old = was.byScope[scope][side];
        const now = result.stacks.byScope[scope][side];
        const gone = old.length - now.length;
        expect(now, `${side} of ${scope} lost a far-end run`).toEqual(old.slice(gone));
        if (old.length > 0) expect(now.length, "a side keeps its top").toBeGreaterThan(0);
        for (let i = 0; i < gone; i++) this.model.removeAt(scope, side, 0);
        if (gone > 0) {
          const without = {
            ...was,
            byScope: { ...was.byScope, [scope]: { ...was.byScope[scope], [side]: now } },
          };
          expect(undoBytes(without, named), "a dropped run freed bytes").toBeLessThan(
            undoBytes(was, named),
          );
        }
      }
    }
    const left = undoBytes(this.stacks, named);
    if (left <= budget) return;
    for (const scope of SCOPES) {
      for (const side of SIDES) {
        const steps = this.stacks.byScope[scope][side];
        for (let n = 1; n < steps.length; n++) {
          const stack = { ...this.stacks.byScope[scope], [side]: steps.slice(n) };
          const without = { ...this.stacks, byScope: { ...this.stacks.byScope, [scope]: stack } };
          expect(undoBytes(without, named), "no run left that frees bytes").toBe(left);
        }
      }
    }
  }

  /** Undo everything in reach, then redo what that undid, on a copy. Where no
   * unrecorded write sits on a step's cell and no typing run is open, the
   * document comes back as it was. */
  private roundTrip() {
    const copy = this.clone();
    const start = cellsOfDoc(copy.doc);
    const exact = copy.model.clean() && copy.model.open() === null;
    const redos = () => SCOPES.reduce((n, s) => n + copy.stacks.byScope[s].redo.length, 0);
    const base = redos();
    for (let i = 0; i < 60 && copy.press("undo") !== "none"; i++) {
      copy.settle();
      copy.check();
    }
    for (let i = 0; i < 60 && redos() > base && copy.press("redo") !== "none"; i++) {
      copy.settle();
      copy.check();
    }
    if (exact && redos() === base)
      expect(cellsOfDoc(copy.doc), "undo all, redo all").toEqual(start);
  }
}

// ── Commands and properties ────────────────────────────────────────────

const id = fc.constantFrom(...IDS);
const n = fc.nat({ max: 3 });
const view = fc.constantFrom(...VIEWS);
const press = (t: "undo" | "redo") => fc.constant<Op>({ t });
const plain = (t: "hide" | "hold" | "lock" | "forget" | "type" | "trip") => fc.constant<Op>({ t });

const WHATS = [
  "steps",
  "files",
  "preset",
  "model",
  "stepsWithModel",
  "prompt",
  "edit",
  "add",
  "remove",
  "reorder",
];

const op: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 8,
    arbitrary: fc.record({
      t: fc.constant("change" as const),
      what: fc.constantFrom(...WHATS),
      n,
      id,
    }),
  },
  { weight: 6, arbitrary: press("undo") },
  { weight: 4, arbitrary: press("redo") },
  { weight: 4, arbitrary: plain("type") },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("view" as const), view }) },
  {
    weight: 1,
    arbitrary: fc.record({
      t: fc.constant("ignore" as const),
      what: fc.constantFrom("steps", "model", "edit"),
      n,
      id,
    }),
  },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("follow" as const), id }) },
  { weight: 1, arbitrary: plain("hide") },
  { weight: 1, arbitrary: plain("lock") },
  { weight: 1, arbitrary: plain("forget") },
  { weight: 1, arbitrary: plain("hold") },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("commit" as const), k: n, n }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("wait" as const), view }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("land" as const), k: n, n }) },
  {
    weight: 1,
    arbitrary: fc.record({
      t: fc.constant("cut" as const),
      cids: fc.subarray(["c0", "c1", "c2", "k"]),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ t: fc.constant("evict" as const), budget: fc.constantFrom(0, 15, 40) }),
  },
  { weight: 1, arbitrary: plain("trip") },
  {
    weight: 3,
    arbitrary: fc.record({ t: fc.constant("field" as const), which: fc.nat({ max: 1 }), n }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      t: fc.constant("clear" as const),
      scope: fc.constantFrom<Scope>("images", "gallery", "shared"),
    }),
  },
);

const RUNS = Number((import.meta.env["VITE_UNDO_MODEL_RUNS"] as string | undefined) ?? 100);

describe("the undo core against its reference model", () => {
  it(
    "agrees after every command, and keeps its invariants",
    () => {
      fc.assert(
        fc.property(fc.array(op, { maxLength: 40 }), (ops) => {
          const rig = new Rig();
          for (const next of ops) rig.apply(next);
          rig.apply({ t: "trip" });
        }),
        { numRuns: RUNS },
      );
    },
    5000 + RUNS * 20,
  );
});

/** Counterexamples the property found, kept as cases of their own. */
describe("the undo core, cases the model found", () => {
  const run = (ops: Op[]) => {
    const rig = new Rig();
    for (const next of ops) rig.apply(next);
  };
  const change = (what: string, k: number): Op => ({ t: "change", what, n: k, id: "a" });

  it("drops a model pick that a later step wrote over, and leaves the model alone", () => {
    // a model pick, then a step that carries another pick with it; from the
    // Gallery only the first is in reach, and it no longer owns the model
    run([
      change("stepsWithModel", 0),
      change("stepsWithModel", 2),
      { t: "view", view: "gallery" },
      { t: "trip" },
    ]);
  });

  it("never lets a step write a model pick again once it gave the model up", () => {
    // a pick riding on an Images step is undone, a newer shared pick lands,
    // and Redo of the step gives the model up; undoing both and redoing both
    // must leave the newer pick in place
    run([
      change("stepsWithModel", 1),
      { t: "undo" },
      change("model", 3),
      { t: "redo" },
      { t: "trip" },
    ]);
  });

  it("keeps a stack within the step limit when a typing run closes with a stepped-back part", () => {
    run([
      change("steps", 1),
      change("steps", 2),
      change("steps", 3),
      change("steps", 0),
      { t: "type" },
      { t: "type" },
      { t: "undo" },
      { t: "hide" },
    ]);
  });
});
