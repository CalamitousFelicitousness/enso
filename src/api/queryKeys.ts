// The keys of the queries the media store's events keep current, and the
// retry rule they share: a refusal answers the same when asked again.

import { ApiError } from "./client";

/** One job's record, as the cards read it. */
export const recordKey = (id: string) => ["record", id] as const;
/** Every job's record. */
export const RECORDS_KEY = ["record"] as const;

/** Ask again after a failure, but not after a refusal. */
export function retryUnlessRefused(failures: number, err: unknown): boolean {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
  return failures < 2;
}
