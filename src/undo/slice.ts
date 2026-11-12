// A recorded slice: the part of one store the undo history records, how it is
// compared, diffed and written back. Generic: the adapters in `slices/` bind
// it to a store.

import {
  applyList,
  cell,
  diffKeys,
  diffList,
  type KeyOptions,
  type ListState,
} from "@/lib/undo/patch";
import type { Patch, Scope, Side, Values } from "@/lib/undo/types";

/** A follow-up write to one item of a list slice. */
export interface ItemMove {
  readonly id: string;
  readonly from: unknown;
  readonly to: unknown;
}

export interface Slice<V = unknown> {
  readonly name: string;
  readonly scope: Scope;
  /** The store, for `rehydrating`. */
  readonly store: object;
  subscribe(listener: () => void): () => void;
  /** The recorded part of the store now. */
  read(): V;
  /** No recorded key moved, by identity: cheap enough for every notification. */
  same(a: V, b: V): boolean;
  diff(before: V, after: V): Patch | null;
  /** List items that differ by identity, for follow-up joins. */
  moves?(before: V, after: V): ItemMove[];
  /** The selection the slice's steps restore, never a step of its own. */
  context?(): unknown;
  /** Keys more than one stack can hold, as cells. */
  readonly checked?: readonly string[] | undefined;
  /** Write one side of a patch of this slice. */
  write(patch: Patch, side: Side, context: unknown): void;
  /** The content ids a patch names, with their bytes. */
  cids?(patch: Patch): Iterable<readonly [string, number]>;
  /** The content ids the store's document names now. */
  named?(): Iterable<string>;
}

interface Store<S> {
  getState(): S;
  subscribe(listener: (state: S, previous: S) => void): () => void;
}

const sameKeys = (keys: readonly string[]) => (a: Values, b: Values) =>
  keys.every((key) => Object.is(a[key], b[key]));

const pick = (state: object, keys: readonly string[]): Values => {
  const source = state as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = source[key];
  return out;
};

export interface KeySliceOptions<S> extends KeyOptions {
  readonly name: string;
  readonly scope: Scope;
  readonly store: Store<S>;
  readonly keys: readonly string[];
  /** Write values back in one call. */
  readonly set: (values: Values) => void;
  readonly checked?: readonly string[];
}

/** Flat keys of one store. */
export function keySlice<S extends object>(options: KeySliceOptions<S>): Slice<Values> {
  const { name, scope, store, keys, set } = options;
  return {
    name,
    scope,
    store,
    subscribe: (listener) => store.subscribe(listener),
    read: () => pick(store.getState(), keys),
    same: sameKeys(keys),
    diff: (before, after) => diffKeys(name, before, after, keys, options),
    checked: options.checked?.map((key) => cell(name, key)),
    write: (patch, side) => {
      if (patch.kind === "keys") set(patch[side]);
    },
  };
}

export interface ListSliceOptions<S, T> extends KeyOptions {
  readonly name: string;
  readonly scope: Scope;
  readonly store: Store<S>;
  readonly items: (state: S) => readonly T[];
  readonly idOf: (item: T) => string;
  /** The slice's keys beside the list. */
  readonly keys: readonly string[];
  readonly context?: (state: S) => unknown;
  /** Write the list and keys back in one call, with the step's selection. */
  readonly set: (next: ListState<T>, context: unknown) => void;
  readonly cids?: (patch: Patch) => Iterable<readonly [string, number]>;
  readonly named?: () => Iterable<string>;
}

/** A list of items by id, with keys beside it. */
export function listSlice<S extends object, T>(
  options: ListSliceOptions<S, T>,
): Slice<ListState<T>> {
  const { name, scope, store, items, idOf, keys, set } = options;
  const sameValues = sameKeys(keys);
  const read = (): ListState<T> => {
    const state = store.getState();
    return { items: items(state), keys: pick(state, keys) };
  };
  return {
    name,
    scope,
    store,
    subscribe: (listener) => store.subscribe(listener),
    read,
    same: (a, b) => a.items === b.items && sameValues(a.keys, b.keys),
    diff: (before, after) => diffList(name, before, after, idOf, keys, options),
    moves: (before, after) => {
      if (before.items === after.items) return [];
      const was = new Map(before.items.map((item) => [idOf(item), item]));
      return after.items.flatMap((item) => {
        const from = was.get(idOf(item));
        return from !== undefined && from !== item ? [{ id: idOf(item), from, to: item }] : [];
      });
    },
    ...(options.context && { context: () => options.context?.(store.getState()) }),
    write: (patch, side, context) => {
      if (patch.kind === "list") set(applyList(read(), patch, side, idOf), context);
    },
    ...(options.cids && { cids: options.cids }),
    ...(options.named && { named: options.named }),
  };
}
