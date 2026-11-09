// What a reset deletes, worked out from the manifest and the rows chosen.

import type { MetaKey } from "@/lib/inputs/metaKeys";
import { BLOBS, DOCUMENTS, HASHES } from "@/lib/inputs/storeLayout";
import { CONTENT_ROWS, type ProfileEntry, type ProfileGroup, type ResetRow } from "./manifest";
import { DB, type DbName, type LocalKey } from "./names";

/** A localStorage record kept in part: its state rewritten with only `keep`,
 * or without `drop`. */
export type LocalRewrite =
  { key: LocalKey; keep: readonly string[] } | { key: LocalKey; drop: readonly string[] };

export interface ResetPlan {
  /** localStorage keys removed. */
  remove: LocalKey[];
  rewrite: LocalRewrite[];
  /** Databases deleted whole. */
  databases: DbName[];
  /** Records deleted from databases that stay. */
  records: { db: DbName; store: string; keys: string[] }[];
  /** enso-inputs cleared in place: these document stores emptied (the working
   * document replaced by an empty one), these meta keys deleted, and the
   * bytes and hashes nothing left names. Null when it is deleted whole or
   * nothing in it goes. */
  inputs: { clear: string[]; meta: MetaKey[] } | null;
  /** Every content row: the first-run marker and the keys and databases of
   * other builds go too. */
  full: boolean;
}

/** The groups a choice of rows deletes. What older builds kept is deleted
 * with everything else of enso-inputs when there is none of it. */
export function chosenGroups(rows: Iterable<ResetRow>, held: boolean): Set<ProfileGroup> {
  const groups = new Set<ProfileGroup>(rows);
  if (CONTENT_ROWS.every((row) => groups.has(row))) groups.add("caches");
  if (!held) groups.add("legacy");
  return groups;
}

/** Bytes and hashes rows go by what still names them, not by a group. */
const DERIVED = new Set<string>([BLOBS, HASHES]);

export function planReset(
  manifest: readonly ProfileEntry[],
  rows: Iterable<ResetRow>,
  held: boolean,
): ResetPlan {
  const chosen = [...rows];
  const groups = chosenGroups(chosen, held);
  const plan: ResetPlan = {
    remove: [],
    rewrite: [],
    databases: [],
    records: [],
    inputs: null,
    full: CONTENT_ROWS.every((row) => chosen.includes(row)),
  };

  for (const entry of manifest) {
    if (entry.kind === "local") {
      const record = groups.has(entry.group);
      const fields = entry.fields && groups.has(entry.fields.group);
      if (!entry.fields) {
        if (record) plan.remove.push(entry.key);
      } else if (record && fields) {
        plan.remove.push(entry.key);
      } else if (record) {
        plan.rewrite.push({ key: entry.key, keep: entry.fields.names });
      } else if (fields) {
        plan.rewrite.push({ key: entry.key, drop: entry.fields.names });
      }
    } else if (entry.kind === "database" && groups.has(entry.group)) {
      plan.databases.push(entry.db);
    }
  }

  const records = new Map<DbName, Extract<ProfileEntry, { kind: "record" }>[]>();
  for (const entry of manifest) {
    if (entry.kind !== "record") continue;
    records.set(entry.db, [...(records.get(entry.db) ?? []), entry]);
  }
  for (const [db, entries] of records) {
    const gone = entries.filter((e) => groups.has(e.group));
    if (gone.length === entries.length) plan.databases.push(db);
    else if (gone.length > 0) {
      for (const store of new Set(gone.map((e) => e.store))) {
        plan.records.push({
          db,
          store,
          keys: gone.filter((e) => e.store === store).map((e) => e.key),
        });
      }
    }
  }

  const inputs = manifest.filter(
    (e): e is Extract<ProfileEntry, { kind: "store" | "meta" }> =>
      e.kind === "store" || e.kind === "meta",
  );
  if (inputs.every((e) => groups.has(e.group))) {
    plan.databases.push(DB.inputs);
  } else {
    const clear = inputs.flatMap((e) =>
      e.kind === "store" && groups.has(e.group) && !DERIVED.has(e.store) ? [e.store] : [],
    );
    const meta = inputs.flatMap((e) => (e.kind === "meta" && groups.has(e.group) ? [e.key] : []));
    if (clear.length > 0 || meta.length > 0) plan.inputs = { clear, meta };
  }
  return plan;
}

/** Whether the plan replaces the working document with an empty one. */
export function emptiesDocument(plan: ResetPlan): boolean {
  return plan.inputs?.clear.includes(DOCUMENTS) ?? false;
}

/** A stored zustand record with only `keep` of its state, or without `drop`;
 * null when nothing is left of it or it cannot be read. */
export function rewriteRecord(raw: string, rewrite: LocalRewrite): string | null {
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof stored !== "object" || stored === null) return null;
  const { state, version } = stored as { state?: unknown; version?: unknown };
  if (typeof state !== "object" || state === null) return null;
  const entries = Object.entries(state).filter(([name]) =>
    "keep" in rewrite ? rewrite.keep.includes(name) : !rewrite.drop.includes(name),
  );
  if (entries.length === 0) return null;
  return JSON.stringify({ state: Object.fromEntries(entries), version });
}
