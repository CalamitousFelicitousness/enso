// Which actions a job card or a result offers, each with the reason it
// cannot act. A card's slots are fixed by the job's type and state, never by
// what is possible at the moment, so a row keeps its shape; a slot that
// cannot act is disabled with its reason, and one that acts in a way worth
// knowing says so in a note.

import type { JobStatus } from "@/api/types/v2";
import { isTerminal, isVideoDomain, type JobDomain } from "./domains";
import { replayProblem, type ReplayProblemCode } from "./replay";

/** What the server's record of a job says. */
export interface JobFacts {
  domain: JobDomain;
  /** The record names this browser as its sender. */
  mine: boolean;
  /** Its result has reached a strip, or never will. */
  routed: boolean;
  /** The record holds the frames the job was built from. */
  hasInputs: boolean;
  /** Uploads the request names that the server cannot send as they are. */
  missingRefs: number;
  /** Other pictures the record names whose bytes the server lost. */
  lost: number;
  /** Pictures the record could not keep when it was sent. */
  unavailable: number;
}

/** What is known of a job's record: its facts, being read, none kept, or not
 * readable now. */
export type FactsState = JobFacts | "loading" | "none" | "error";

export type ActionReason =
  | Exclude<ReplayProblemCode, "remake">
  | "loading"
  | "factsError"
  | "noRecord"
  | "olderResult"
  | "noInputs"
  | "unfinished"
  | "notGenerate"
  | "first"
  | "last"
  | "notQueued"
  | "noResult"
  | "otherView";

/** How a slot that can act will act, when that is worth saying. */
export type ActionNote = "remake";

export interface Slot<A extends string> {
  action: A;
  reason: ActionReason | null;
  note?: ActionNote;
}

/** The view a domain's results are shown in. */
export type ResultView = "images" | "video" | "process";

export function viewOf(domain: JobDomain): ResultView | null {
  if (domain === "generate" || domain === "preprocess") return "images";
  if (isVideoDomain(domain)) return "video";
  if (domain === "process" || domain === "upscale" || domain === "rembg") return "process";
  return null;
}

/** The reason a known state gives where facts are needed, or null for facts. */
function stateReason(facts: FactsState): ActionReason | null {
  if (facts === "loading") return "loading";
  if (facts === "error") return "factsError";
  if (facts === "none") return "noRecord";
  return null;
}

function runAgainSlot<A extends string>(action: A, status: JobStatus, facts: FactsState): Slot<A> {
  if (!isTerminal(status)) return { action, reason: "unfinished" };
  const known = stateReason(facts);
  if (known || typeof facts === "string") return { action, reason: known };
  const problem = replayProblem(facts);
  if (problem === "remake") return { action, reason: null, note: "remake" };
  return { action, reason: problem };
}

export type HistoryAction = "restoreSettings" | "restoreBoth" | "runAgain" | "delete";

/** Job types a History card runs again from: every type with a record but
 * the video ones and Process now, which their own views run again. */
const REPLAYABLE = new Set([
  "generate",
  "detail",
  "cloud_image",
  "xyz-grid",
  "upscale",
  "rembg",
  "process",
]);

export interface HistoryJob {
  /** The server's job type. */
  type: string;
  status: JobStatus;
  /** The server returned the request it ran, as a completed job does. */
  hasParams: boolean;
}

/** A History card's slots. Only a local image generation restores; a job
 * without a record restores what the server returned with it. */
export function historySlots(job: HistoryJob, facts: FactsState): Slot<HistoryAction>[] {
  const remove: Slot<HistoryAction> = { action: "delete", reason: null };
  if (!REPLAYABLE.has(job.type)) return [remove];
  const runAgain = runAgainSlot<HistoryAction>("runAgain", job.status, facts);
  if (job.type !== "generate") return [runAgain, remove];
  const known = stateReason(facts);
  const recorded = typeof facts !== "string";
  // the settings of a job without a record come from what the server returned
  const settings =
    recorded || job.hasParams
      ? null
      : !isTerminal(job.status)
        ? "unfinished"
        : (known ?? "noRecord");
  const inputs = !recorded ? known : facts.hasInputs ? null : "noInputs";
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

/** A Queue card's three slots for its state. */
export function queueSlots(
  job: QueueJob,
  facts: FactsState,
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
    runAgainSlot<QueueAction>("runAgain", job.status, facts),
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

/** What each restore and Run again of a result on the strip does: a reason
 * it cannot act, or a note on how it will. A result whose record or bytes go
 * missing later restores its settings and says so; that is found when it runs. */
export function resultActions(
  result: ResultFacts,
  facts: FactsState,
): Record<ResultAction, Slot<ResultAction>> {
  const settings = result.type === null || result.type === "generate" ? null : "notGenerate";
  let inputs: ActionReason | null;
  if (typeof facts !== "string") inputs = facts.hasInputs ? null : "noInputs";
  else if (result.legacyInputs) inputs = null;
  else inputs = result.jobId === null ? "olderResult" : stateReason(facts);
  const runAgain: Slot<ResultAction> =
    result.jobId === null
      ? { action: "runAgain", reason: "olderResult" }
      : runAgainSlot<ResultAction>("runAgain", "completed", facts);
  return {
    restoreSettings: { action: "restoreSettings", reason: settings },
    restoreInputs: { action: "restoreInputs", reason: inputs },
    saveInputs: { action: "saveInputs", reason: inputs },
    restoreBoth: { action: "restoreBoth", reason: settings ?? inputs },
    runAgain,
  };
}
