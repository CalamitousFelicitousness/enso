// Which stored blobs to delete. Blobs are written once and shared by every
// document that names their cid, so nothing deletes one when a document drops
// it; a sweep does, once no document on disk names it any more.

/** What one record of a document store tells a sweep. */
export interface RecordFacts {
  /** The cids the record names. */
  cids: string[];
  /** When the record may be dropped (epoch ms); never when absent. */
  expiresAt?: number;
  /** The record is in the trash: once it expires or is deleted, the bytes
   * only it named go at once, without the grace. */
  inTrash?: boolean;
}

/** What the user set that decides when records expire. */
export interface SweepPolicy {
  /** How long the trash keeps what goes to it. */
  removalMs: number;
}

/** Reads one record of a document store. Throws on a record it cannot account for. */
export type StoreReader = (record: unknown, policy: SweepPolicy) => RecordFacts;

/** A document store's records as one sweep read them, beside their keys. */
export interface StoreRecords<K> {
  store: string;
  keys: readonly K[];
  records: readonly unknown[];
}

/** What a sweep learned from every record of every document store. */
export interface SweepReading<K> {
  /** Every cid a record that stays names. */
  named: Set<string>;
  /** The cids of expired records whose bytes go with them. */
  urgent: Set<string>;
  /** The records past their expiry. */
  expired: { store: string; key: K }[];
}

/** Read one sweep's records. Throws when a store has no reader or a reader
 * cannot account for a record, so the sweep deletes nothing. */
export function readForSweep<K>(
  stores: readonly StoreRecords<K>[],
  readers: Readonly<Record<string, StoreReader>>,
  now: number,
  policy: SweepPolicy,
): SweepReading<K> {
  const reading: SweepReading<K> = { named: new Set(), urgent: new Set(), expired: [] };
  for (const { store, keys, records } of stores) {
    if (!Object.hasOwn(readers, store)) throw new Error(`no reader for ${store}`);
    const read = readers[store];
    records.forEach((record, i) => {
      const facts = read(record, policy);
      if (facts.expiresAt !== undefined && facts.expiresAt <= now) {
        reading.expired.push({ store, key: keys[i] });
        if (facts.inTrash) for (const cid of facts.cids) reading.urgent.add(cid);
        return;
      }
      for (const cid of facts.cids) reading.named.add(cid);
    });
  }
  return reading;
}

/** When each stored blob that no document names was first seen unnamed, by key. */
export type Orphans = Record<string, number>;

export interface SweepPlan {
  /** Blob keys to delete. */
  remove: string[];
  /** The record to keep for the next sweep. */
  orphans: Orphans;
}

/** The cid a blob key belongs to. A picture's thumbnails are stored under `<cid>/`. */
export function blobCid(key: string): string {
  const slash = key.indexOf("/");
  return slash === -1 ? key : key.slice(0, slash);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a blob that no document names is kept, and a cached map unused. */
export const RETENTION_MS = 7 * DAY_MS;

/** The days the trash keeps what goes to it: the user's choice, within these. */
export const TRASH_DAYS = { min: 1, max: 30, fallback: 7 } as const;

/** A stored number of days for the trash, as a whole number within bounds;
 * anything else is the default. */
export function trashDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return TRASH_DAYS.fallback;
  return Math.min(TRASH_DAYS.max, Math.max(TRASH_DAYS.min, Math.round(value)));
}

/** The sweep policy for a number of trash days. */
export function sweepPolicy(days: number): SweepPolicy {
  return { removalMs: trashDays(days) * DAY_MS };
}

/** Whether a blob that has gone unnamed since `since` may be deleted at `now`
 * (both in epoch milliseconds). Until then a picture removed by mistake, or
 * orphaned by a defect, is still on disk. */
export function mayDelete(since: number, now: number): boolean {
  return now - since >= RETENTION_MS;
}

/** Plan one sweep over the stored blob keys. A named blob is never removed.
 * An urgent one goes at once; any other once it has gone unnamed for the
 * retention period, counted from the first sweep that saw it so. */
export function planSweep(
  keys: string[],
  named: ReadonlySet<string>,
  orphans: Orphans,
  now: number,
  urgent: ReadonlySet<string> = new Set(),
): SweepPlan {
  const plan: SweepPlan = { remove: [], orphans: {} };
  for (const key of keys) {
    const cid = blobCid(key);
    if (named.has(cid)) continue;
    if (urgent.has(cid)) {
      plan.remove.push(key);
      continue;
    }
    const seen = Object.hasOwn(orphans, key);
    // a sighting dated after now, from a clock that was wrong, counts from now
    const since = seen ? Math.min(orphans[key], now) : now;
    if (seen && mayDelete(since, now)) plan.remove.push(key);
    else plan.orphans[key] = since;
  }
  return plan;
}

/** When something the trash keeps may be dropped. */
export function removalExpiry(removedAt: number, removalMs: number): number {
  return removedAt + removalMs;
}

/** When a cached map may be dropped: the same period after it was last used. */
export function mapExpiry(usedAt: number): number {
  return usedAt + RETENTION_MS;
}

/** The cids that only records in the trash name: what emptying it frees. */
export function trashOnlyCids(records: readonly RecordFacts[]): Set<string> {
  const elsewhere = new Set<string>();
  const trash = new Set<string>();
  for (const facts of records) {
    for (const cid of facts.cids) (facts.inTrash ? trash : elsewhere).add(cid);
  }
  for (const cid of elsewhere) trash.delete(cid);
  return trash;
}

export interface ReclaimPlan {
  /** Blob keys to delete now. */
  remove: string[];
  /** Cids still asked for that only this page holds, kept for the next try. */
  waiting: string[];
}

/** What deleting from the trash frees at once: the keys of the cids asked
 * for that no record names and this page does not hold. A cid a record names
 * again is no longer asked for. */
export function planReclaim(
  keys: readonly string[],
  asked: ReadonlySet<string>,
  named: ReadonlySet<string>,
  live: ReadonlySet<string>,
): ReclaimPlan {
  const remove = keys.filter((key) => {
    const cid = blobCid(key);
    return asked.has(cid) && !named.has(cid) && !live.has(cid);
  });
  const waiting = [...asked].filter((cid) => !named.has(cid) && live.has(cid));
  return { remove, waiting };
}
