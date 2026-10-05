// Which stored blobs to delete. Blobs are written once and shared by every
// document that names their cid, so nothing deletes one when a document drops
// it; a sweep does, once no document on disk names it any more.

/** When each stored blob that no document names was first seen unnamed, by key. */
export type Orphans = Record<string, number>;

export interface SweepPlan {
  /** Blob keys to delete. */
  remove: string[];
  /** The record to keep for the next sweep. */
  orphans: Orphans;
}

/** The cid a blob key belongs to. A picture's thumbnail is stored as `<cid>/thumb`. */
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

/** Plan one sweep over the stored blob keys. A named blob is never removed,
 * and neither is one seen unnamed for the first time. */
export function planSweep(
  keys: string[],
  named: ReadonlySet<string>,
  orphans: Orphans,
  now: number,
): SweepPlan {
  const plan: SweepPlan = { remove: [], orphans: {} };
  for (const key of keys) {
    if (named.has(blobCid(key))) continue;
    const seen = Object.hasOwn(orphans, key);
    // a sighting dated after now, from a clock that was wrong, counts from now
    const since = seen ? Math.min(orphans[key], now) : now;
    if (seen && mayDelete(since, now)) plan.remove.push(key);
    else plan.orphans[key] = since;
  }
  return plan;
}
