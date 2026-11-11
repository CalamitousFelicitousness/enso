// Patches: what one step changed in one slice, and how either side goes back.

import type { Env, ItemChange, KeyPatch, ListPatch, Patch, Side, Values } from "./types";

function isPlain(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Equality over plain data, by identity for anything else (a Blob, a File).
 * A key holding undefined counts as absent. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameValue(item, b[i]));
  }
  if (!isPlain(a) || !isPlain(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameValue(left[key], right[key])) return false;
  }
  return true;
}

export interface KeyOptions {
  /** Keys that travel together: a patch holding one holds all. */
  readonly groups?: readonly (readonly string[])[];
  /** Equality for keys that compare by less than their whole value. */
  readonly equal?: Readonly<Record<string, (a: unknown, b: unknown) => boolean>>;
}

function changedKeys(
  before: Values,
  after: Values,
  keys: readonly string[],
  { groups = [], equal = {} }: KeyOptions,
): string[] {
  const changed = new Set(
    keys.filter((key) => !(equal[key] ?? sameValue)(before[key], after[key])),
  );
  for (const group of groups) {
    if (group.some((key) => changed.has(key))) for (const key of group) changed.add(key);
  }
  return keys.filter((key) => changed.has(key));
}

const pick = (values: Values, keys: readonly string[]): Values =>
  Object.fromEntries(keys.map((key) => [key, values[key]]));

/** The keys of a flat slice that changed, or null when none did. */
export function diffKeys(
  slice: string,
  before: Values,
  after: Values,
  keys: readonly string[],
  options: KeyOptions = {},
): KeyPatch | null {
  const changed = changedKeys(before, after, keys, options);
  if (changed.length === 0) return null;
  return { slice, kind: "keys", before: pick(before, changed), after: pick(after, changed) };
}

/** A list slice: items with ids, and keys beside them. */
export interface ListState<T = unknown> {
  readonly items: readonly T[];
  readonly keys: Values;
}

const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** The items of a list slice that changed by id, its order when membership or
 * order changed, and its keys; null when nothing did. */
export function diffList<T>(
  slice: string,
  before: ListState<T>,
  after: ListState<T>,
  idOf: (item: T) => string,
  keys: readonly string[],
  options: KeyOptions = {},
): ListPatch | null {
  const was = new Map(before.items.map((item) => [idOf(item), item]));
  const now = new Map(after.items.map((item) => [idOf(item), item]));
  const items: Record<string, ItemChange> = {};
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const b = was.get(id) ?? null;
    const a = now.get(id) ?? null;
    if (!sameValue(b, a)) items[id] = { before: b, after: a };
  }
  const order = { before: [...was.keys()], after: [...now.keys()] };
  const changed = changedKeys(before.keys, after.keys, keys, options);
  const patch: ListPatch = {
    slice,
    kind: "list",
    items,
    order: sameOrder(order.before, order.after) ? null : order,
    keys: { before: pick(before.keys, changed), after: pick(after.keys, changed) },
  };
  return isEmpty(patch) ? null : patch;
}

/** A patch that changes nothing. */
export function isEmpty(patch: Patch): boolean {
  if (patch.kind === "keys") return Object.keys(patch.before).length === 0;
  return (
    Object.keys(patch.items).length === 0 &&
    patch.order === null &&
    Object.keys(patch.keys.before).length === 0
  );
}

/** One key of one slice, or one item as `#id`. */
export const cell = (slice: string, key: string): string => `${slice}\u0000${key}`;

/** The patches without the given keys; a patch left empty goes. */
export function withoutKeys(patches: readonly Patch[], cells: ReadonlySet<string>): Patch[] {
  return patches.flatMap((patch): Patch[] => {
    if (patch.kind !== "keys") return [patch];
    const kept = Object.keys(patch.before).filter((key) => !cells.has(cell(patch.slice, key)));
    if (kept.length === Object.keys(patch.before).length) return [patch];
    const out: KeyPatch = {
      ...patch,
      before: pick(patch.before, kept),
      after: pick(patch.after, kept),
    };
    return isEmpty(out) ? [] : [out];
  });
}

/** A list slice with `side` of the patch written: items by id, in the
 * patch's order where it has one, else in the current order. */
export function applyList<T>(
  current: ListState<T>,
  patch: ListPatch,
  side: Side,
  idOf: (item: T) => string,
): ListState<T> {
  const byId = new Map(current.items.map((item) => [idOf(item), item]));
  const ids = patch.order ? patch.order[side] : current.items.map(idOf);
  const items: T[] = [];
  for (const id of ids) {
    const change = patch.items[id];
    const item = change ? (change[side] as T | null) : (byId.get(id) ?? null);
    if (item !== null) items.push(item);
  }
  return { items, keys: { ...current.keys, ...patch.keys[side] } };
}

/** The same change the other way round. */
export function invert(patch: Patch): Patch {
  if (patch.kind === "keys") return { ...patch, before: patch.after, after: patch.before };
  return {
    ...patch,
    items: Object.fromEntries(
      Object.entries(patch.items).map(([id, c]) => [id, { before: c.after, after: c.before }]),
    ),
    order: patch.order && { before: patch.order.after, after: patch.order.before },
    keys: { before: patch.keys.after, after: patch.keys.before },
  };
}

function composeValues(a: { before: Values; after: Values }, b: { before: Values; after: Values }) {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(a.before), ...Object.keys(b.before)])) {
    const from = key in a.before ? a.before[key] : b.before[key];
    const to = key in b.after ? b.after[key] : a.after[key];
    if (sameValue(from, to)) continue;
    before[key] = from;
    after[key] = to;
  }
  return { before, after };
}

function composeOne(a: Patch, b: Patch): Patch | null {
  if (a.kind === "keys" && b.kind === "keys") {
    const values = composeValues(a, b);
    const patch: KeyPatch = { slice: a.slice, kind: "keys", ...values };
    return isEmpty(patch) ? null : patch;
  }
  if (a.kind !== "list" || b.kind !== "list") throw new Error(`Slice ${a.slice} changed kind`);
  const items: Record<string, ItemChange> = {};
  for (const id of new Set([...Object.keys(a.items), ...Object.keys(b.items)])) {
    const first = a.items[id];
    const second = b.items[id];
    const from = first ? first.before : second?.before;
    const to = second ? second.after : first?.after;
    if (!sameValue(from, to)) items[id] = { before: from ?? null, after: to ?? null };
  }
  const from = a.order?.before ?? b.order?.before ?? null;
  const to = b.order?.after ?? a.order?.after ?? null;
  const order = from && to && !sameOrder(from, to) ? { before: from, after: to } : null;
  const patch: ListPatch = {
    slice: a.slice,
    kind: "list",
    items,
    order,
    keys: composeValues(a.keys, b.keys),
  };
  return isEmpty(patch) ? null : patch;
}

/** `a` then `b`, as one change from `a`'s before to `b`'s after; slices that
 * end where they began are left out. */
export function compose(a: readonly Patch[], b: readonly Patch[]): Patch[] {
  const slices = new Set([...a.map((p) => p.slice), ...b.map((p) => p.slice)]);
  const out: Patch[] = [];
  for (const slice of slices) {
    const first = a.find((p) => p.slice === slice);
    const second = b.find((p) => p.slice === slice);
    const patch = first && second ? composeOne(first, second) : (first ?? second);
    if (patch && !isEmpty(patch)) out.push(patch);
  }
  return out;
}

/** From where `a` ends to where `b` ends, both begun from the same state. */
export function span(a: readonly Patch[], b: readonly Patch[]): Patch[] {
  return compose(a.map(invert), b);
}

/** What a patch touches, as slice-qualified keys and item ids. */
export function touched(patches: readonly Patch[]): Set<string> {
  const out = new Set<string>();
  for (const patch of patches) {
    const keys = patch.kind === "keys" ? patch.before : patch.keys.before;
    for (const key of Object.keys(keys)) out.add(cell(patch.slice, key));
    if (patch.kind === "list") {
      for (const id of Object.keys(patch.items)) out.add(cell(patch.slice, `#${id}`));
      if (patch.order) out.add(cell(patch.slice, "#order"));
    }
  }
  return out;
}

/** Every content id the patches name, with the largest size reported for it. */
export function cidsOf(patches: readonly Patch[], env: Pick<Env, "cidsOf">): Map<string, number> {
  const out = new Map<string, number>();
  for (const patch of patches) {
    for (const [cid, bytes] of env.cidsOf(patch)) out.set(cid, Math.max(bytes, out.get(cid) ?? 0));
  }
  return out;
}
