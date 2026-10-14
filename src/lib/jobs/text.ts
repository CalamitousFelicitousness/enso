// The words for job records, restores and Run again, in one place: cards,
// menus, toasts, the palette and the live suite read them from here.

import { ageText, OLDER_SERVER } from "@/lib/media/text";
import type { ActionNote, ActionReason, OutputJobLookup } from "./cardActions";
import type { JobDomain } from "./domains";
import type { LoadsModel } from "./requests";

const REASON: Record<ActionReason, string> = {
  processNow: "Processing runs again through Process now",
  gone: "A file this job sent is no longer stored",
  storeOff: "Job records are unavailable while the media store is off",
  olderServer: OLDER_SERVER,
  loading: "Reading the job's record",
  factsError: "Could not read the job's record",
  noRecord: "Enso kept no record of this job",
  noJobFound: "No Enso job found for this file",
  lookupFailed: "Could not look up the job",
  olderResult: "This result was made by an older version of Enso",
  noInputs: "This job was sent with no input pictures",
  unfinished: "This job has not finished yet",
  notGenerate: "Only an image generation's settings and inputs can be restored",
  first: "Already first in the queue",
  last: "Already last in the queue",
  notQueued: "Only a queued job can be moved",
  noResult: "This job has no result",
  otherView: "Results of this kind are kept in the Gallery",
};

export function reasonText(reason: ActionReason): string {
  return REASON[reason];
}

/** What loading a job's own model does, named when the request names it. */
function loadsText(model: string | null | undefined): string {
  return `Loads ${model ?? "the job's video model"} first, in place of the loaded model`;
}

export function noteText(note: ActionNote, model?: string | null): string {
  return note === "remake"
    ? "Some pictures are made again from the saved inputs"
    : loadsText(model);
}

/** A slot's words: why it cannot act, quiet while its record is read, or how it will. */
export function slotWords(slot: {
  reason: ActionReason | null;
  note?: ActionNote;
  model?: string;
}): {
  reason: string | null;
  quiet: boolean;
  note: string | null;
} {
  return {
    reason: slot.reason ? reasonText(slot.reason) : null,
    quiet: slot.reason === "loading",
    note: slot.note ? noteText(slot.note, slot.model) : null,
  };
}

export const RESTORE_SETTINGS = "Restore settings";
export const RESTORE_INPUTS = "Restore inputs";
export const RESTORE_BOTH = "Restore settings and inputs";
export const RUN_AGAIN = "Run again";
export const RESTORE_JOB_INPUTS = "Restore the job's inputs";
export const RUN_JOB_AGAIN = "Run the job again";
export const NO_RESULT = "No result yet";

/** Run again of a run over many pictures. */
export function processesAgainText(count: number): string {
  return `Processes all ${count} pictures again`;
}

const JOB_NOUN: Record<JobDomain, string> = {
  generate: "image",
  upscale: "upscale",
  rembg: "background removal",
  process: "Process",
  preprocess: "preprocess",
  video: "video",
  framepack: "FramePack",
  ltx: "LTX",
  "xyz-grid": "XYZ grid",
};

export const LOOKING_UP_JOB = "Looking up the job";

/** The job that made a file, as the line above its job's slots says it:
 * being looked up, none, known by id alone, or known by its record. */
export function outputJobText(
  lookup: OutputJobLookup,
  record: { domain: JobDomain; createdAt: number } | null,
  now: number,
): string {
  if (lookup.state === "loading") return LOOKING_UP_JOB;
  if (lookup.state === "failed") return REASON.lookupFailed;
  if (lookup.state === "none") return REASON.noJobFound;
  if (!record) return `From Enso job ${lookup.id.slice(0, 8)}`;
  return `From an Enso ${JOB_NOUN[record.domain]} job, ${ageText(now - record.createdAt)}`;
}

export const COPY_JOB_ID = "Copy the job's id";

export const MOVE_UP = "Move up";
export const MOVE_DOWN = "Move down";

export type RestoreKind = "settings" | "inputs" | "both";

const RESTORED: Record<RestoreKind, string> = {
  settings: "Settings restored",
  inputs: "Inputs restored",
  both: "Settings and inputs restored",
};

/** A restore's notice; one started in another view says where it landed. */
export function restoredText(kind: RestoreKind, elsewhere = false): string {
  return elsewhere ? `${RESTORED[kind]} in the Images view` : RESTORED[kind];
}

const RESTORING: Record<Exclude<RestoreKind, "settings">, string> = {
  inputs: "Restoring inputs",
  both: "Restoring settings and inputs",
};

/** A restore's notice while its inputs are read. */
export function restoringText(kind: Exclude<RestoreKind, "settings">, elsewhere = false): string {
  return elsewhere ? `${RESTORING[kind]} in the Images view` : RESTORING[kind];
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

/** A job queued again, and the model it loads first when it loads its own. */
export function runAgainQueuedText(loads: LoadsModel | null): string {
  if (!loads) return RUN_AGAIN_QUEUED;
  return `${RUN_AGAIN_QUEUED}; it loads ${loads.model ?? "its video model"} first, in place of the loaded model`;
}

export const RUN_AGAIN_FAILED = "Could not run the job again";
export const OTHER_MODEL = "Running on a different model";

export function otherModelText(ranOn: string, loaded: string): string {
  return `This job ran on ${ranOn}; ${loaded} is loaded`;
}

/** What a job sent that a record no longer holds the bytes of. */
export type ReplayMissing = "picture" | "mask" | "map" | "lut" | "file";

const MISSING: Record<ReplayMissing, string> = {
  picture: "A picture this job sent is no longer stored",
  mask: "A mask this job sent is no longer stored",
  map: "A map this job sent is no longer stored",
  lut: "The color LUT this job sent is no longer stored",
  file: "A file this job sent is no longer stored",
};

export function replayMissingText(missing: ReplayMissing): string {
  return MISSING[missing];
}

export const MOVE_STARTED = "The job started before it could be moved";

export const FAILED_WHILE_CLOSED = "Failed while the page was closed";

const jobs = (n: number) => (n === 1 ? "1 job" : `${n} jobs`);

/** The question before the finished jobs leave the server; null before they are counted. */
export function clearHistoryTitle(finished: number | null): string {
  if (finished === null) return "Remove every finished job from the server?";
  return `Remove ${finished === 1 ? "1 finished job" : `${finished} finished jobs`} from the server?`;
}

/** How many of them this page knows; null for none. */
export function fromThisBrowserText(here: number): string | null {
  if (here === 0) return null;
  return here === 1 ? "1 is from this browser." : `${here} are from this browser.`;
}

export const HISTORY_LOSES = "History loses them in every browser.";

/** What leaving the server's job history leaves of a job. */
export const RESULTS_KEPT =
  "Saved results stay in the Gallery and on the strips, and Run again and Restore keep working; results that were not saved are deleted.";

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

export const NEWER_RECORD = "This job was recorded by a newer version of Enso";

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
