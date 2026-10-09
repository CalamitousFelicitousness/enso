// Which actions a job card or a result offers, each with the reason it
// cannot act. A card's slots are fixed by the job's type and state, never by
// what is possible at the moment, so a row keeps its shape; a slot that
// cannot act is disabled with its reason.

import type { JobStatus } from "@/api/types/v2";
import { isTerminal, isVideoDomain, type JobDomain } from "./domains";
import type { ReplayProblemCode } from "./replay";

/** What this browser's record says about a job. */
export interface JobFacts {
  domain: JobDomain;
  /** The record holds the frames the job was built from. */
  hasInputs: boolean;
  replay: ReplayProblemCode | null;
  routed: boolean;
}

export type ActionReason =
  | ReplayProblemCode
  | "noRecord"
  | "notStored"
  | "olderResult"
  | "noInputs"
  | "unfinished"
  | "notGenerate"
  | "first"
  | "last"
  | "notQueued"
  | "noResult"
  | "otherView";

export interface Slot<A extends string> {
  action: A;
  reason: ActionReason | null;
}

/** The view a domain's results are shown in. */
export type ResultView = "images" | "video" | "process";

export function viewOf(domain: JobDomain): ResultView | null {
  if (domain === "generate" || domain === "preprocess") return "images";
  if (isVideoDomain(domain)) return "video";
  if (domain === "process" || domain === "upscale" || domain === "rembg") return "process";
  return null;
}

function runAgainReason(
  status: JobStatus,
  facts: JobFacts | null,
  unrecorded: "noRecord" | "notStored",
): ActionReason | null {
  if (!isTerminal(status)) return "unfinished";
  return facts ? facts.replay : unrecorded;
}

export type HistoryAction = "restoreSettings" | "restoreBoth" | "runAgain" | "delete";

/** Job types whose record can be sent again. */
const REPLAYABLE = new Set(["generate", "detail", "cloud_image", "xyz-grid"]);

export interface HistoryJob {
  /** The server's job type. */
  type: string;
  status: JobStatus;
  /** The server returned the request it ran, as a completed job does. */
  hasParams: boolean;
  /** A result on the strip or a job tracked here names it. */
  sentHere: boolean;
}

/** A History card's slots. Only a local image generation restores; a job
 * without a record restores what the server returned with it. One this
 * browser sent lost its record when it was sent; any other came from
 * elsewhere. */
export function historySlots(job: HistoryJob, facts: JobFacts | null): Slot<HistoryAction>[] {
  const remove: Slot<HistoryAction> = { action: "delete", reason: null };
  if (!REPLAYABLE.has(job.type)) return [remove];
  const unrecorded = job.sentHere ? "notStored" : "noRecord";
  const runAgain: Slot<HistoryAction> = {
    action: "runAgain",
    reason: runAgainReason(job.status, facts, unrecorded),
  };
  if (job.type !== "generate") return [runAgain, remove];
  const settings =
    facts || job.hasParams ? null : isTerminal(job.status) ? unrecorded : "unfinished";
  const inputs = !facts ? unrecorded : facts.hasInputs ? null : "noInputs";
  return [
    { action: "restoreSettings", reason: settings },
    { action: "restoreBoth", reason: settings ?? inputs },
    runAgain,
    remove,
  ];
}

export type QueueAction = "moveUp" | "moveDown" | "cancel" | "view" | "runAgain" | "remove";

export interface QueueJob {
  status: JobStatus;
  domain: JobDomain;
  hasResult: boolean;
}

/** A Queue card's three slots for its state. A job tracked here was sent
 * from this browser, so one without a record lost it when it was sent. */
export function queueSlots(
  job: QueueJob,
  facts: JobFacts | null,
  place: { first: boolean; last: boolean },
): Slot<QueueAction>[] {
  if (job.status === "pending") {
    return [
      { action: "moveUp", reason: place.first ? "first" : null },
      { action: "moveDown", reason: place.last ? "last" : null },
      { action: "cancel", reason: null },
    ];
  }
  if (job.status === "running") {
    return [
      { action: "moveUp", reason: "notQueued" },
      { action: "moveDown", reason: "notQueued" },
      { action: "cancel", reason: null },
    ];
  }
  const view = !job.hasResult ? "noResult" : viewOf(job.domain) ? null : "otherView";
  return [
    { action: "view", reason: view },
    { action: "runAgain", reason: runAgainReason(job.status, facts, "notStored") },
    { action: "remove", reason: null },
  ];
}

export type ResultAction =
  "restoreSettings" | "restoreInputs" | "restoreBoth" | "runAgain" | "saveInputs";

export interface ResultFacts {
  /** The job the result came from; null for a result of an older build. */
  jobId: string | null;
  /** The server's job type; null for a result of an older build. */
  type: string | null;
  /** An older build kept the result's inputs beside it. */
  legacyInputs: boolean;
}

/** Why each restore and Run again of a result on the strip cannot act. A
 * result whose record or bytes go missing later restores its settings and
 * says so; that is found when it runs. */
export function resultActions(
  result: ResultFacts,
  facts: JobFacts | null,
): Record<ResultAction, ActionReason | null> {
  const settings = result.type === null || result.type === "generate" ? null : "notGenerate";
  let inputs: ActionReason | null;
  if (facts) inputs = facts.hasInputs ? null : "noInputs";
  else if (result.legacyInputs) inputs = null;
  else inputs = result.jobId === null ? "olderResult" : "notStored";
  let runAgain: ActionReason | null;
  if (result.jobId === null) runAgain = "olderResult";
  else runAgain = facts ? facts.replay : "notStored";
  return {
    restoreSettings: settings,
    restoreInputs: inputs,
    saveInputs: inputs,
    restoreBoth: settings ?? inputs,
    runAgain,
  };
}
