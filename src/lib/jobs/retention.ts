// How many job records this browser keeps, and which go.

import type { StoredJob } from "@/lib/inputs/stored";
import { stripDomain } from "./domains";

export const JOB_RECORDS_CAP = 200;

/** The server deletes a finished job this long after it ended. */
export const SERVER_JOB_RETENTION_MS = 168 * 60 * 60 * 1000;

export interface RecordSummary {
  id: string;
  createdAt: number;
}

/** The records past the newest `cap` that `keep` does not name, oldest first. */
export function planJobTrim(
  records: readonly RecordSummary[],
  cap: number,
  keep: ReadonlySet<string>,
): string[] {
  if (records.length <= cap) return [];
  return [...records]
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .slice(cap)
    .filter((r) => !keep.has(r.id))
    .reverse()
    .map((r) => r.id);
}

/** A record whose result can still reach the strip at a page start: a
 * generation or a video the server may still hold, not routed yet. */
export function awaitsRouting(
  record: Pick<StoredJob, "domain" | "routed" | "createdAt">,
  now: number,
): boolean {
  return (
    stripDomain(record.domain) && !record.routed && now - record.createdAt < SERVER_JOB_RETENTION_MS
  );
}
