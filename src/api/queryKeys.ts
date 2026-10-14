// The keys of the queries the media store's events keep current, and the
// retry rule they share: a refusal answers the same when asked again.

import { STORE_OFF } from "@/lib/media/text";
import { ApiError } from "./client";

/** One job's record, as the cards read it. */
export const recordKey = (id: string) => ["record", id] as const;
/** Every job's record. */
export const RECORDS_KEY = ["record"] as const;
/** The library's entries; a prefix of the trash and of each entry. */
export const LIBRARY_KEY = ["library"] as const;
export const TRASH_KEY = ["library", "trash"] as const;
export const entryKey = (id: string) => ["library", "entry", id] as const;
/** Under the library's key, so its events read the older build's list again
 * too: another tab may be moving it. */
export const LEGACY_ENTRIES_KEY = ["library", "legacy"] as const;
/** The settings the server keeps for every browser. */
export const SETTINGS_KEY = ["media-settings"] as const;
/** The server's description of itself, its input limit among it. */
export const SERVER_INFO_KEY = ["server-info"] as const;
/** The media store's report: its root, space and verify state. */
export const REPORT_KEY = ["media-report"] as const;
/** This browser's job records, for the record cap's counts. */
export const MY_RECORDS_KEY = ["my-records"] as const;
/** The job that made a Gallery file, by its path; a prefix of every file's. */
export const OUTPUT_JOBS_KEY = ["output-job"] as const;
export const outputJobKey = (path: string) => ["output-job", path] as const;
/** The Gallery files in the server's trash. */
export const GALLERY_TRASH_KEY = ["gallery-trash"] as const;
/** Which outputs have their files in the trash, or had them deleted from it lately. */
export const TRASHED_OUTPUTS_KEY = ["trashed-outputs"] as const;

/** Ask again after a failure, but not after a refusal: a 4xx, or a coded answer
 * such as the media store being off. */
export function retryUnlessRefused(failures: number, err: unknown): boolean {
  if (err instanceof ApiError && (err.code !== null || (err.status >= 400 && err.status < 500))) {
    return false;
  }
  return failures < 2;
}

/** The media store is off on the server: a state, not an error. The words
 * to show are the refusal's own, a whole sentence. */
export function storeOffIn(err: unknown): string | null {
  return err instanceof ApiError && err.code === "media_store_off"
    ? err.detail?.message || STORE_OFF
    : null;
}
