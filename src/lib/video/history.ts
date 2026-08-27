import type { VideoResult } from "@/api/types/video";

/** Most results a user may pin. Pins ride above the history cap, so without a
 * ceiling the working set, the rehydrate read and the pinned row all grow
 * without bound. */
export const MAX_PINNED = 20;

export interface Eviction {
  keep: VideoResult[];
  drop: string[];
}

/**
 * Split newest-first rows into the ones history keeps and the ids it drops.
 *
 * `limit` budgets only the evictable rows: pinned results and whatever the UI
 * currently points at ride above the cap. One policy, computed once, so the
 * in-memory list and the database cannot disagree about what survives.
 */
export function evict(
  rows: readonly VideoResult[],
  limit: number,
  retained: ReadonlySet<string>,
): Eviction {
  const keep: VideoResult[] = [];
  const drop: string[] = [];
  let budget = limit;
  for (const row of rows) {
    if (row.pinned || retained.has(row.id)) {
      keep.push(row);
    } else if (budget > 0) {
      keep.push(row);
      budget--;
    } else {
      drop.push(row.id);
    }
  }
  return { keep, drop };
}
