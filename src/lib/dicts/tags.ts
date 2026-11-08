// Autocomplete tag dictionaries as columns sorted by name in code-unit order,
// one entry per name: a single dictionary, or the enabled ones merged.

import type { DictTag } from "@/api/types/dict";

export interface DictColumns {
  names: string[];
  categories: Uint8Array;
  counts: Float64Array;
}

/** The columns as one record: names joined by newlines, which no name holds. */
export interface PackedColumns {
  names: string;
  categories: Uint8Array;
  counts: Float64Array;
}

export const NO_TAGS: DictColumns = {
  names: [],
  categories: new Uint8Array(0),
  counts: new Float64Array(0),
};

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A server dictionary's `[name, category, count]` rows as columns. A name
 * listed twice keeps its highest count; a name holding a newline is dropped. */
export function columnsFromRows(rows: readonly (readonly [string, number, number])[]): DictColumns {
  const best = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const name = rows[i][0];
    if (name.includes("\n")) continue;
    const prior = best.get(name);
    if (prior === undefined || rows[i][2] > rows[prior][2]) best.set(name, i);
  }
  // the default sort orders strings by code unit, as the lookups do, and is
  // several times faster than a comparator over a million names
  const names = [...best.keys()].sort();
  const categories = new Uint8Array(names.length);
  const counts = new Float64Array(names.length);
  for (let k = 0; k < names.length; k++) {
    const [, category, count] = rows[best.get(names[k]) ?? 0];
    categories[k] = category;
    counts[k] = count;
  }
  return { names, categories, counts };
}

/** Two dictionaries as one; a name in both keeps the entry with the higher
 * count, `a`'s on a tie. */
function mergeTwo(a: DictColumns, b: DictColumns): DictColumns {
  const names: string[] = [];
  const categories = new Uint8Array(a.names.length + b.names.length);
  const counts = new Float64Array(a.names.length + b.names.length);
  const take = (from: DictColumns, i: number) => {
    categories[names.length] = from.categories[i];
    counts[names.length] = from.counts[i];
    names.push(from.names[i]);
  };
  let i = 0;
  let j = 0;
  while (i < a.names.length && j < b.names.length) {
    const order = byName(a.names[i], b.names[j]);
    if (order < 0) take(a, i++);
    else if (order > 0) take(b, j++);
    else {
      if (b.counts[j] > a.counts[i]) take(b, j);
      else take(a, i);
      i++;
      j++;
    }
  }
  while (i < a.names.length) take(a, i++);
  while (j < b.names.length) take(b, j++);
  return {
    names,
    categories: categories.slice(0, names.length),
    counts: counts.slice(0, names.length),
  };
}

/** The dictionaries merged in pairs; earlier ones win ties. */
export function mergeColumns(dicts: readonly DictColumns[]): DictColumns {
  if (dicts.length === 0) return NO_TAGS;
  let round = [...dicts];
  while (round.length > 1) {
    const next: DictColumns[] = [];
    for (let k = 0; k < round.length; k += 2) {
      next.push(k + 1 < round.length ? mergeTwo(round[k], round[k + 1]) : round[k]);
    }
    round = next;
  }
  return round[0];
}

export function packColumns(columns: DictColumns): PackedColumns {
  return {
    names: columns.names.join("\n"),
    categories: columns.categories,
    counts: columns.counts,
  };
}

/** Null when the record is not packed columns of one length. */
export function unpackColumns(packed: unknown): DictColumns | null {
  if (typeof packed !== "object" || packed === null) return null;
  const { names, categories, counts } = packed as Partial<PackedColumns>;
  if (typeof names !== "string") return null;
  if (!(categories instanceof Uint8Array) || !(counts instanceof Float64Array)) return null;
  const list = categories.length === 0 ? [] : names.split("\n");
  if (list.length !== categories.length || list.length !== counts.length) return null;
  return { names: list, categories, counts };
}

function lowerBound(names: readonly string[], prefix: string): number {
  let lo = 0;
  let hi = names.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (names[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const tagAt = (columns: DictColumns, i: number): DictTag => ({
  name: columns.names[i],
  category: columns.categories[i],
  count: columns.counts[i],
});

/** Up to `limit` tags starting with `query`, by name; when none does and the
 * query has 4 or more characters, the first `limit` by name that contain it,
 * most used first. */
export function findTags(columns: DictColumns, query: string, limit: number): DictTag[] {
  const { names } = columns;
  const found: DictTag[] = [];
  for (let i = lowerBound(names, query); i < names.length && found.length < limit; i++) {
    if (!names[i].startsWith(query)) break;
    found.push(tagAt(columns, i));
  }
  if (found.length > 0 || query.length < 4) return found;
  for (let i = 0; i < names.length && found.length < limit; i++) {
    if (names[i].includes(query)) found.push(tagAt(columns, i));
  }
  return found.sort((a, b) => b.count - a.count);
}
