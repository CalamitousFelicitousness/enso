// The words for job records, restores and Run again, in one place: cards,
// menus, toasts, the palette and the live suite read them from here.

import type { ActionReason } from "./cardActions";

const REASON: Record<ActionReason, string> = {
  video: "Video jobs cannot be run again yet",
  processNow: "Processing runs again through Process now",
  lutUpload: "This job used a color LUT, which cannot be sent again yet",
  unrecordedUploads: "This job cannot be run again: its pictures were not kept",
  noRecord: "This job was sent from another browser",
  notStored: "Its inputs could not be stored when it was sent",
  olderResult: "This result was made by an older version of Enso",
  noInputs: "This job was sent with no input pictures",
  unfinished: "This job has not finished yet",
  notGenerate: "Only the settings of an image generation can be restored",
  first: "Already first in the queue",
  last: "Already last in the queue",
  notQueued: "Only a queued job can be moved",
  noResult: "This job has no result",
  otherView: "Results of this kind are kept in the Gallery",
};

export function reasonText(reason: ActionReason): string {
  return REASON[reason];
}

export const RESTORE_SETTINGS = "Restore settings";
export const RESTORE_INPUTS = "Restore inputs";
export const RESTORE_BOTH = "Restore settings and inputs";
export const RUN_AGAIN = "Run again";
export const MOVE_UP = "Move up";
export const MOVE_DOWN = "Move down";

export type RestoreKind = "settings" | "inputs" | "both";

const RESTORED: Record<RestoreKind, string> = {
  settings: "Settings restored",
  inputs: "Inputs restored",
  both: "Settings and inputs restored",
};

export function restoredText(kind: RestoreKind): string {
  return RESTORED[kind];
}

/** What a restore left as it was, for its notice. */
export type RestoreNote = "seedNotRecorded" | "lutNotRestored" | "inputsGone";

const NOTE: Record<RestoreNote, string> = {
  seedNotRecorded: "Seed not recorded for this result; it stays random",
  lutNotRestored: "Color LUT not restored",
  inputsGone: "The inputs of this result are no longer stored",
};

export function restoreNotesText(notes: readonly RestoreNote[]): string | null {
  return notes.length > 0 ? notes.map((n) => NOTE[n]).join(". ") : null;
}

export function lostPicturesText(count: number): string {
  return count === 1
    ? "One picture of this result could not be read"
    : `${count} pictures of this result could not be read`;
}

export const RUN_AGAIN_QUEUED = "Job queued again";
export const RUN_AGAIN_FAILED = "Could not run the job again";
export const OTHER_MODEL = "Running on a different model";

export function otherModelText(ranOn: string, loaded: string): string {
  return `This job ran on ${ranOn}; ${loaded} is loaded`;
}

/** What a job sent that a record no longer holds the bytes of. */
export type ReplayMissing = "picture" | "mask" | "map";

const MISSING: Record<ReplayMissing, string> = {
  picture: "A picture this job sent is no longer stored",
  mask: "A mask this job sent is no longer stored",
  map: "A map this job sent is no longer stored",
};

export function replayMissingText(missing: ReplayMissing): string {
  return MISSING[missing];
}

export const RECORD_FAILED = "The job's inputs could not be stored";
export const RECORD_FAILED_DETAIL =
  "Its result will not bring them back and the job cannot be run again";

export const MOVE_STARTED = "The job started before it could be moved";

export const FAILED_WHILE_CLOSED = "Failed while the page was closed";

const jobs = (n: number) => (n === 1 ? "1 job" : `${n} jobs`);

/** The jobs that ended while no page was open; null for none. */
export function closedPageText(finished: number, failed: number): string | null {
  if (finished > 0 && failed > 0) {
    return `${jobs(finished)} finished and ${failed} failed while the page was closed`;
  }
  if (finished > 0) return `${jobs(finished)} finished while the page was closed`;
  if (failed > 0) return `${jobs(failed)} failed while the page was closed`;
  return null;
}

export function onStripText(count: number): string {
  return count === 1 ? "Its result is on the strip" : "Their results are on the strip";
}

export const HISTORY_UNREAD = "The stored results could not be read";
export const HISTORY_UNREAD_DETAIL = "Every job is still in History";

export const STRIP_LIMIT_LABEL = "Results kept on the strip";

/** The line under the strip limit: how many are on the strip, or how many
 * the limit being set will take off it. */
export function stripLimitText(onStrip: number, limit: number): string {
  const leaving = onStrip - limit;
  if (leaving <= 0) return `${onStrip} on the strip now`;
  return leaving === 1
    ? "1 older result will leave the strip"
    : `${leaving} older results will leave the strip`;
}

export function stripTrimmedText(count: number): { title: string; description: string } {
  return count === 1
    ? { title: "1 older result removed from the strip", description: "It stays in History" }
    : {
        title: `${count} older results removed from the strip`,
        description: "They stay in History",
      };
}

export const RESTORE_LAST = "Restore last settings";
export const RESTORE_LAST_BOTH = "Restore last settings and inputs";
export const RUN_LAST_AGAIN = "Run the last job again";
export const NO_RESULT_YET = "No result to restore yet";
export const LAST_NOT_REPLAYABLE = "The last job cannot be run again";
export const RESTORE_LAST_TITLE =
  "Restore last settings (Shift+click compares with the current settings)";
export const DOUBLE_CLICK_HINT = "Double-click restores settings";
