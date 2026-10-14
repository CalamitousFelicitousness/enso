// The settings the server keeps for every browser: what committing a row
// does, and the counts a reduction is told with.

import { asJobDomain, stripDomain } from "@/lib/jobs/domains";

export type SharedSetting = "trash_days" | "library_cap" | "record_cap";

/** What a reduction lets go that this browser can see. */
export interface ReductionCounts {
  /** Here: removed inputs, or this browser's job records. */
  here: number;
  /** On the server: trashed or saved entries. */
  server: number;
  /** On the server: files in the Gallery trash. */
  files: number;
}

/** A raise is written at once; a reduction is asked first, since the server
 * deletes for every browser, unless it lets go nothing this browser can see.
 * The record cap always asks: other browsers' records are not listed here. */
export function commitKind(
  setting: SharedSetting,
  current: number,
  next: number,
  counts: ReductionCounts,
): "none" | "write" | "confirm" {
  if (next === current) return "none";
  if (next > current) return "write";
  if (setting === "record_cap") return "confirm";
  return counts.here + counts.server + counts.files > 0 ? "confirm" : "write";
}

/** The server keeps a finished job this long; a strip record younger than
 * this that has not reached its strip is not retired. */
const STRIP_RETENTION_MS = 168 * 60 * 60 * 1000;

export interface RecordFacts {
  job_id: string;
  created_at: number;
  routed: boolean;
  domain: string;
}

/** How many of this browser's records a cap of `cap` retires, as the
 * server's pass decides: the excess, oldest first, never a live job's and
 * never an unrouted strip record younger than 168 hours, a skip not counting
 * toward the excess. */
export function retirable(
  records: readonly RecordFacts[],
  cap: number,
  live: ReadonlySet<string>,
  now: number,
): number {
  let excess = records.length - cap;
  let retired = 0;
  const oldestFirst = [...records].sort(
    (a, b) => a.created_at - b.created_at || a.job_id.localeCompare(b.job_id),
  );
  for (const record of oldestFirst) {
    if (excess <= 0) break;
    if (live.has(record.job_id)) continue;
    const domain = asJobDomain(record.domain);
    if (
      !record.routed &&
      domain &&
      stripDomain(domain) &&
      record.created_at > now - STRIP_RETENTION_MS
    ) {
      continue;
    }
    retired += 1;
    excess -= 1;
  }
  return retired;
}

/** A server whose retention is shorter than this browser's would let the
 * browser's removed inputs go early: asked once, before it does. */
export function shortensRetention(server: number, local: number): boolean {
  return server < local;
}

/** The input limit's slider positions: a thousand megapixel positions on a
 * short track could not be dragged to. */
export const INPUT_LIMIT_STEPS: readonly number[] = [
  16, 24, 32, 48, 64, 89, 128, 192, 256, 384, 512, 768, 1000,
].map((mp) => mp * 1_000_000);

/** The position a limit sits at: the largest step at or below it. */
export function inputLimitStep(pixels: number): number {
  const below = INPUT_LIMIT_STEPS.filter((step) => step <= pixels).length;
  return Math.max(0, below - 1);
}
