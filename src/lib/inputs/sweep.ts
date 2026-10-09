// Which stored blobs to delete. Blobs are written once and shared by every
// document that names their cid, so nothing deletes one when a document drops
// it; a sweep does, once no document on disk names it any more.

/** What one record of a document store tells a sweep. */
export interface RecordFacts {
  /** The cids the record names. */
  cids: string[];
  /** When the record may be dropped (epoch ms); never when absent. */
  expiresAt?: number;
  /** The record is in the trash: once it expires, the bytes only it named go
   * at once, without the grace. */
  inTrash?: boolean;
}

/** Reads one record of a document store. Throws on a record it cannot account for. */
export type StoreReader = (record: unknown) => RecordFacts;

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
): SweepReading<K> {
  const reading: SweepReading<K> = { named: new Set(), urgent: new Set(), expired: [] };
  for (const { store, keys, records } of stores) {
    if (!Object.hasOwn(readers, store)) throw new Error(`no reader for ${store}`);
    const read = readers[store];
    records.forEach((record, i) => {
      const facts = read(record);
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

/** How long a blob that no document names is kept. */
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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

/** When a removal record may be dropped: the same period as its bytes. */
export function removalExpiry(removedAt: number): number {
  return removedAt + RETENTION_MS;
}

/** When a cached map may be dropped: the same period after it was last used. */
export function mapExpiry(usedAt: number): number {
  return usedAt + RETENTION_MS;
}
