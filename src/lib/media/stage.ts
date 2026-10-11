// A builder writes a placeholder where an upload ref goes; the batch's run
// maps every placeholder to the ref of bytes the server holds, and nothing is
// posted while one is left, since sdnext would try to read it as a picture.

import type { Source } from "@/lib/inputs/stored";
import { ReplayError, UPLOAD_PREFIX } from "@/lib/jobs/replay";
import type { ReplayMissing } from "@/lib/jobs/text";
import { isHash } from "./hash";

export const STAGED_PREFIX = "staged:";

const STAGED = /^staged:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A placeholder for an upload ref, made of an id no prompt would hold. */
export function isStaged(value: unknown): value is string {
  return typeof value === "string" && STAGED.test(value);
}

/** What a placeholder became: the ref and hash of bytes the server holds, or
 * gone when the bytes were neither held nor sendable. */
export type Outcome = { ref: string; hash: string; size: number } | { gone: true; source?: Source };

export function isGone(outcome: Outcome): outcome is { gone: true; source?: Source } {
  return "gone" in outcome;
}

/** Every placeholder a request names, however deep, once each. */
export function stagedIn(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (isStaged(v)) found.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "object" && v !== null) Object.values(v).forEach(walk);
  };
  walk(value);
  return [...found];
}

const MISSING: Record<Source["kind"], ReplayMissing> = {
  composite: "picture",
  file: "picture",
  mask: "mask",
  ipMask: "mask",
  map: "map",
};

/** A deep copy of the request with each placeholder replaced by its upload
 * ref. A placeholder whose bytes are gone throws ReplayError for its kind. */
export function substituteStaged<T>(value: T, outcomes: ReadonlyMap<string, Outcome>): T {
  const walk = (v: unknown): unknown => {
    if (isStaged(v)) {
      const outcome = outcomes.get(v);
      if (!outcome) return v;
      if (isGone(outcome))
        throw new ReplayError(outcome.source ? MISSING[outcome.source.kind] : "picture");
      return outcome.ref;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === "object" && v !== null) {
      return Object.fromEntries(Object.entries(v).map(([key, x]) => [key, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

/** Throws when a placeholder is left in the request. */
export function assertNoneStaged(value: unknown): void {
  const [left] = stagedIn(value);
  if (left) throw new Error(`A picture was not uploaded before the job was sent (${left})`);
}

/** The hashes an `upload_missing` issue list names. An issue's input is the
 * ref for a job's upload and the bare hash for a record's picture; one hash
 * can be both, so each is named once. */
export function missesOf(issues: readonly { type: string; input?: unknown }[]): string[] {
  const hashes = new Set<string>();
  for (const issue of issues) {
    if (issue.type !== "upload_missing" || typeof issue.input !== "string") continue;
    const hash = issue.input.startsWith(UPLOAD_PREFIX)
      ? issue.input.slice(UPLOAD_PREFIX.length)
      : issue.input;
    if (isHash(hash)) hashes.add(hash);
  }
  return [...hashes];
}
