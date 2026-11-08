// Autocomplete tag dictionaries as columns sorted by name in code-unit order,
// one entry per name, with the aliases and translations that point at them;
// and the ranking of tags for a query, the same rules sdnext's own UI follows.

import type { DictTag } from "@/api/types/dict";

/** Alias or translation terms in code-unit order, each naming a tag by index. */
export interface TermColumns {
  keys: string[];
  targets: Uint32Array;
}

export interface DictColumns {
  names: string[];
  categories: Uint8Array;
  counts: Float64Array;
  aliases: TermColumns;
  translations: TermColumns;
}

/** Merged dictionaries, with every name in one string, a newline after each,
 * for native substring search. */
export interface DictIndex extends DictColumns {
  joined: string;
  /** Where each name starts in `joined`. */
  starts: Uint32Array;
}

/** A tag found for a query; `via` is the alias or translation that matched. */
export interface TagMatch extends DictTag {
  via?: string;
}

/** The columns as one record: each list of strings joined by newlines,
 * which no name or term holds. */
export interface PackedColumns {
  names: string;
  categories: Uint8Array;
  counts: Float64Array;
  aliasKeys: string;
  aliasTargets: Uint32Array;
  translationKeys: string;
  translationTargets: Uint32Array;
}

const NO_TERMS: TermColumns = { keys: [], targets: new Uint32Array(0) };

export const NO_TAGS: DictIndex = {
  names: [],
  categories: new Uint8Array(0),
  counts: new Float64Array(0),
  aliases: NO_TERMS,
  translations: NO_TERMS,
  joined: "",
  starts: new Uint32Array(0),
};

/** A word of a tag starts after one of these. */
const WORD_BREAKS = "_-(/";

const usable = (term: unknown): term is string =>
  typeof term === "string" && term.length > 0 && !term.includes("\n");

function lowerBound(sorted: readonly string[], key: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function indexOfName(names: readonly string[], name: string): number {
  const i = lowerBound(names, name);
  return names[i] === name ? i : -1;
}

/** Term-to-tag pairs as columns: sorted by term, then tag; pairs whose tag is
 * not in `names` and repeated pairs left out. */
function termColumns(pairs: readonly (readonly [string, string])[], names: readonly string[]) {
  const found: [string, number][] = [];
  for (const [key, name] of pairs) {
    const target = indexOfName(names, name);
    if (target >= 0) found.push([key, target]);
  }
  found.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  const keys: string[] = [];
  const targets: number[] = [];
  for (const [key, target] of found) {
    if (
      keys.length > 0 &&
      keys[keys.length - 1] === key &&
      targets[targets.length - 1] === target
    ) {
      continue;
    }
    keys.push(key);
    targets.push(target);
  }
  return { keys, targets: Uint32Array.from(targets) };
}

/** A server dictionary as columns: its `[name, category, count, aliases?]`
 * rows and its translations (foreign term to tag name). Everything is
 * lowercased; a name listed twice keeps its highest count and both its
 * aliases; a name or term holding a newline is dropped. */
export function columnsFromContent(
  rows: readonly unknown[],
  translations?: Readonly<Record<string, unknown>> | null,
): DictColumns {
  const best = new Map<string, number>();
  const rowCount = new Float64Array(rows.length);
  const rowCategory = new Uint8Array(rows.length);
  const aliasPairs: [string, string][] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    // indexed reads: destructuring walks the iterator protocol, slow over a million rows
    const rawName: unknown = row[0];
    const category: unknown = row[1];
    const count: unknown = row[2];
    const aliases: unknown = row[3];
    if (!usable(rawName) || typeof category !== "number" || typeof count !== "number") continue;
    const name = rawName.toLowerCase();
    rowCount[r] = count;
    rowCategory[r] = category;
    const prior = best.get(name);
    if (prior === undefined || count > rowCount[prior]) best.set(name, r);
    if (Array.isArray(aliases)) {
      for (const alias of aliases) if (usable(alias)) aliasPairs.push([alias.toLowerCase(), name]);
    }
  }
  // the default sort orders strings by code unit, as the lookups do, and is
  // several times faster than a comparator over a million names
  const names = [...best.keys()].sort();
  const categories = new Uint8Array(names.length);
  const counts = new Float64Array(names.length);
  for (let k = 0; k < names.length; k++) {
    const r = best.get(names[k]) ?? 0;
    categories[k] = rowCategory[r];
    counts[k] = rowCount[r];
  }
  const translationPairs: [string, string][] = [];
  for (const [foreign, canonical] of Object.entries(translations ?? {})) {
    if (usable(foreign) && usable(canonical)) {
      translationPairs.push([foreign.toLowerCase(), canonical.toLowerCase()]);
    }
  }
  return {
    names,
    categories,
    counts,
    aliases: termColumns(aliasPairs, names),
    translations: termColumns(translationPairs, names),
  };
}

type Tags = Pick<DictColumns, "names" | "categories" | "counts">;

/** Two dictionaries' tags as one; a name in both keeps the entry with the
 * higher count, `a`'s on a tie. */
function mergeTwo(a: Tags, b: Tags): Tags {
  const names: string[] = [];
  const categories = new Uint8Array(a.names.length + b.names.length);
  const counts = new Float64Array(a.names.length + b.names.length);
  const take = (from: Tags, i: number) => {
    categories[names.length] = from.categories[i];
    counts[names.length] = from.counts[i];
    names.push(from.names[i]);
  };
  let i = 0;
  let j = 0;
  while (i < a.names.length && j < b.names.length) {
    const nameA = a.names[i];
    const nameB = b.names[j];
    if (nameA < nameB) take(a, i++);
    else if (nameA > nameB) take(b, j++);
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

/** Every name in one string, each followed by a newline, and where each starts. */
function joinNames(names: readonly string[]): { joined: string; starts: Uint32Array } {
  const starts = new Uint32Array(names.length);
  let at = 0;
  for (let i = 0; i < names.length; i++) {
    starts[i] = at;
    at += names[i].length + 1;
  }
  return { joined: names.length === 0 ? "" : `${names.join("\n")}\n`, starts };
}

/** The tag whose name holds position `at` of the joined names. */
function tagAt(starts: Uint32Array, at: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (starts[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Every tag whose name holds `pattern`, found with native search. */
function tagsHolding(index: DictIndex, pattern: string, into: Set<number>): void {
  const { joined, starts } = index;
  for (let at = joined.indexOf(pattern); at >= 0; at = joined.indexOf(pattern, at + 1)) {
    into.add(tagAt(starts, at));
  }
}

/** The dictionaries merged, earlier ones winning ties, with every alias and
 * translation pointing at the merged tag of its name. */
export function mergeColumns(dicts: readonly DictColumns[]): DictIndex {
  if (dicts.length === 0) return NO_TAGS;
  let round: Tags[] = [...dicts];
  while (round.length > 1) {
    const next: Tags[] = [];
    for (let k = 0; k < round.length; k += 2) {
      next.push(k + 1 < round.length ? mergeTwo(round[k], round[k + 1]) : round[k]);
    }
    round = next;
  }
  const { names, categories, counts } = round[0];
  const pairs = (pick: (d: DictColumns) => TermColumns) =>
    dicts.flatMap((d) => {
      const terms = pick(d);
      return terms.keys.map((key, k) => [key, d.names[terms.targets[k]]] as const);
    });
  return {
    names,
    categories,
    counts,
    aliases:
      dicts.length === 1
        ? dicts[0].aliases
        : termColumns(
            pairs((d) => d.aliases),
            names,
          ),
    translations:
      dicts.length === 1
        ? dicts[0].translations
        : termColumns(
            pairs((d) => d.translations),
            names,
          ),
    ...joinNames(names),
  };
}

export function packColumns(columns: DictColumns): PackedColumns {
  return {
    names: columns.names.join("\n"),
    categories: columns.categories,
    counts: columns.counts,
    aliasKeys: columns.aliases.keys.join("\n"),
    aliasTargets: columns.aliases.targets,
    translationKeys: columns.translations.keys.join("\n"),
    translationTargets: columns.translations.targets,
  };
}

const split = (joined: string, length: number) => (length === 0 ? [] : joined.split("\n"));

/** Null when the record is not packed columns whose lists agree in length and
 * whose terms name tags that exist. */
export function unpackColumns(packed: unknown): DictColumns | null {
  if (typeof packed !== "object" || packed === null) return null;
  const p = packed as Partial<PackedColumns>;
  if (
    typeof p.names !== "string" ||
    typeof p.aliasKeys !== "string" ||
    typeof p.translationKeys !== "string" ||
    !(p.categories instanceof Uint8Array) ||
    !(p.counts instanceof Float64Array) ||
    !(p.aliasTargets instanceof Uint32Array) ||
    !(p.translationTargets instanceof Uint32Array)
  ) {
    return null;
  }
  const names = split(p.names, p.categories.length);
  const aliasKeys = split(p.aliasKeys, p.aliasTargets.length);
  const translationKeys = split(p.translationKeys, p.translationTargets.length);
  if (names.length !== p.categories.length || names.length !== p.counts.length) return null;
  if (aliasKeys.length !== p.aliasTargets.length) return null;
  if (translationKeys.length !== p.translationTargets.length) return null;
  if (p.aliasTargets.some((t) => t >= names.length)) return null;
  if (p.translationTargets.some((t) => t >= names.length)) return null;
  return {
    names,
    categories: p.categories,
    counts: p.counts,
    aliases: { keys: aliasKeys, targets: p.aliasTargets },
    translations: { keys: translationKeys, targets: p.translationTargets },
  };
}

/** Terms equal to `query` (`whole`) or starting with it, as tag and term. */
function termsFor(terms: TermColumns, query: string, whole: boolean): [number, string][] {
  const found: [number, string][] = [];
  for (let k = lowerBound(terms.keys, query); k < terms.keys.length; k++) {
    const key = terms.keys[k];
    if (!key.startsWith(query)) break;
    if ((key === query) === whole) found.push([terms.targets[k], key]);
  }
  return found;
}

/** Up to `limit` tags for what was typed, best first: the tag itself or an
 * alias or translation of it; tags starting with it or with a later word
 * starting with it, taken together; aliases and translations starting with
 * it; and only when none of those, tags containing it (4 or more characters)
 * or a translation containing it (2 or more). Most used first within each,
 * then by name. */
export function findTags(index: DictIndex, typed: string, limit: number): TagMatch[] {
  const query = typed.trim().toLowerCase().replace(/ /g, "_");
  if (!query || limit <= 0) return [];
  const { names, categories, counts } = index;
  const found: TagMatch[] = [];
  const placed = new Set<number>();
  const byUse = (a: number, b: number) => counts[b] - counts[a] || a - b;
  /** Places a tier's candidates, each tag once, most used first. */
  const place = (candidates: readonly (readonly [number, string | undefined])[]) => {
    const via = new Map<number, string | undefined>();
    for (const [tag, term] of candidates) {
      if (!placed.has(tag) && (!via.has(tag) || term === undefined)) via.set(tag, term);
    }
    for (const tag of [...via.keys()].sort(byUse)) {
      if (found.length >= limit) return;
      placed.add(tag);
      const term = via.get(tag);
      found.push({
        name: names[tag],
        category: categories[tag],
        count: counts[tag],
        ...(term !== undefined && { via: term }),
      });
    }
  };

  const exact = indexOfName(names, query);
  place([
    ...(exact >= 0 ? [[exact, undefined] as const] : []),
    ...termsFor(index.aliases, query, true),
    ...termsFor(index.translations, query, true),
  ]);

  // one tier, so a popular `large_breasts` is not buried under every `breasts_*`
  const words = new Set<number>();
  for (let i = lowerBound(names, query); i < names.length && names[i].startsWith(query); i++) {
    words.add(i);
  }
  // a break inside a name: the word after it is not the name's first
  for (const mark of WORD_BREAKS) tagsHolding(index, mark + query, words);
  place([...words].map((i) => [i, undefined] as const));

  place([...termsFor(index.aliases, query, false), ...termsFor(index.translations, query, false)]);
  if (found.length > 0) return found;

  const containing: [number, string | undefined][] = [];
  if (query.length >= 4) {
    const holding = new Set<number>();
    tagsHolding(index, query, holding);
    for (const i of holding) containing.push([i, undefined]);
  }
  if (query.length >= 2) {
    const { keys, targets } = index.translations;
    for (let k = 0; k < keys.length; k++) {
      if (keys[k].includes(query)) containing.push([targets[k], keys[k]]);
    }
  }
  place(containing);
  return found;
}
