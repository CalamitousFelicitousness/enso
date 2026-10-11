// A job and its record go to the server in one request. Preparing runs the
// action's batch once: each placeholder in the request becomes the ref of
// bytes the server holds, and the record names the hash of every picture its
// frames name, or declares the picture unavailable. A post is never aborted:
// the server may have queued the job the moment it took the body.

import { toast } from "sonner";
import { UploadRefused } from "@/lib/media/refused";
import { api, ApiError, issuesOf } from "@/api/client";
import { serverInfoQuery } from "@/api/hooks/useServer";
import { queryClient } from "@/api/queryClient";
import { recordKey } from "@/api/queryKeys";
import type { ReqRecordV2 } from "@/api/types/media";
import type { Job, JobRequest } from "@/api/types/v2";
import { newId } from "@/lib/id";
import {
  readStoredInputs,
  storedInputsOf,
  type Inputs,
  type Source,
  type StoredInputs,
  type StoredJob,
} from "@/lib/inputs/stored";
import { holdsContent } from "@/lib/inputs/types";
import type { JobFacts } from "@/lib/jobs/cardActions";
import { stripDomain, type JobDomain } from "@/lib/jobs/domains";
import { refsIn, substituteRefs } from "@/lib/jobs/replay";
import { assembleRecord } from "@/lib/media/record";
import {
  assertNoneStaged,
  isGone,
  missesOf,
  stagedIn,
  substituteStaged,
  type Outcome,
} from "@/lib/media/stage";
import {
  keptOutText,
  OLDER_SERVER,
  STORE_OFF,
  submitFailureText,
  type SubmitFailure,
} from "@/lib/media/text";
import { useJobQueueStore } from "@/stores/jobStore";
import { clientId } from "./client";
import type { Ledger, Uploader } from "./materialise";
import type { UploadBatch } from "./uploads";

/** A job as a builder made it, its uploads staged and not yet sent. */
export interface Submission {
  domain: JobDomain;
  /** Its upload refs are placeholders on `batch`, or real already. */
  request: JobRequest;
  batch: UploadBatch;
  /** Where each staged upload came from, and the bytes the record names. */
  ledger: Ledger;
  /** The frames the request was built from, or as a record stored them; null
   * when they held nothing. */
  inputs: Inputs | StoredInputs | null;
  /** The maps the job makes before generating. */
  mapKeys: string[];
  checkpoint: StoredJob["checkpoint"];
}

/** The frames a job was built from, when they hold anything to bring back. */
export function keptInputs(inputs: Inputs): Inputs | null {
  return inputs.frames.some(holdsContent) ? inputs : null;
}

/** A built job with the record's pictures staged beside its own uploads. */
export function submissionOf(parts: {
  domain: JobDomain;
  request: JobRequest;
  batch: UploadBatch;
  uploader: Uploader;
  inputs: Inputs;
  mapKeys: string[];
  checkpoint: StoredJob["checkpoint"];
}): Submission {
  const kept = keptInputs(parts.inputs);
  parts.uploader.stageRecord(kept?.frames ?? []);
  return {
    domain: parts.domain,
    request: parts.request,
    batch: parts.batch,
    ledger: parts.uploader.ledger,
    inputs: kept,
    mapKeys: parts.mapKeys,
    checkpoint: parts.checkpoint,
  };
}

/** A job ready to post, every ref in it real. */
export interface Prepared {
  submission: Submission;
  request: JobRequest;
  /** Null when the server has no media store on: the job goes without one. */
  record: ReqRecordV2 | null;
  /** What each staged upload became. */
  outcomes: ReadonlyMap<string, Outcome>;
}

/** Why a job and its record were not sent. */
export class SubmitRefused extends Error {
  override name = "SubmitRefused";
  readonly failure: SubmitFailure;
  constructor(failure: SubmitFailure, options?: ErrorOptions) {
    super(submitFailureText(failure), options);
    this.failure = failure;
  }
}

/** A new id for one post; a Retry of that post sends it again, so the server
 * answers the job it queued instead of queuing a second. */
export function newSubmitId(): string {
  return newId().replaceAll("-", "");
}

/** Why the server keeps no uploads; null when its media store is on, or when
 * the server cannot be asked (the claim then says so). */
async function storeOff(): Promise<string | null> {
  try {
    const info = await queryClient.fetchQuery(serverInfoQuery);
    if (!info.media_store) return OLDER_SERVER;
    return info.media_store.enabled === false ? (info.media_store.reason ?? STORE_OFF) : null;
  } catch {
    return null;
  }
}

/** The record for a request whose staged uploads became `outcomes`. */
async function recordOf(
  submission: Submission,
  request: JobRequest,
  outcomes: ReadonlyMap<string, Outcome>,
): Promise<ReqRecordV2> {
  const real = (ref: string): string | null => {
    const outcome = outcomes.get(ref);
    if (!outcome) return ref;
    return isGone(outcome) ? null : outcome.ref;
  };
  const refs: Record<string, Source> = {};
  for (const [ref, source] of Object.entries(submission.ledger.refs)) {
    const sent = real(ref);
    if (sent) refs[sent] = source;
  }
  const hashes = new Map<string, string>();
  for (const [cid, ref] of submission.ledger.cids) {
    const outcome = outcomes.get(ref);
    if (outcome && !isGone(outcome)) hashes.set(cid, outcome.hash);
  }
  const inputs = submission.inputs && storedInputsOf(submission.inputs);
  const record = assembleRecord({
    client: await clientId(),
    checkpoint: submission.checkpoint,
    request,
    refs,
    inputs,
    inputCids: inputs ? readStoredInputs(inputs).cids : [],
    mapKeys: submission.mapKeys,
    maps: submission.ledger.maps,
    hashes,
  });
  assertNoneStaged(record);
  return record;
}

/** Run the submission's batch and assemble its record. With the media store
 * off, a request that names no upload goes without a record and one that
 * does is refused with the reason. */
export async function prepare(submission: Submission): Promise<Prepared> {
  const off = await storeOff();
  if (off !== null) {
    if (stagedIn(submission.request).length > 0 || refsIn(submission.request).length > 0) {
      throw new UploadRefused({ kind: "storeOff", message: off });
    }
    return { submission, request: submission.request, record: null, outcomes: new Map() };
  }
  const outcomes = await submission.batch.run();
  const request = substituteStaged(submission.request, outcomes);
  assertNoneStaged(request);
  const kept = submission.batch.keptOut;
  if (kept) toast.info(keptOutText(kept.count, kept.room));
  return { submission, request, record: await recordOf(submission, request, outcomes), outcomes };
}

/** The hashes a 422 names as not held; null for any other refusal. */
export function missingHashes(err: unknown): Set<string> | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null;
  const misses = missesOf(issuesOf(err) ?? []);
  return misses.length > 0 ? new Set(misses) : null;
}

/** Send the bytes of `misses` again and put their refs in the request and the
 * record; throws when one cannot be sent. */
async function resend(prepared: Prepared, misses: ReadonlySet<string>): Promise<Prepared> {
  const { submission } = prepared;
  const names = submission.batch.namesOf(misses);
  const unknown = [...misses].filter((hash) => !names.has(hash));
  if (unknown.length > 0) {
    throw new SubmitRefused({ kind: "stillMissing", names: [...names.values()] });
  }
  const again = await submission.batch.again({}, misses).run();
  const outcomes = new Map(prepared.outcomes);
  const swaps = new Map<string, string>();
  const goneRefs = new Set<string>();
  const lost: string[] = [];
  for (const [ref, outcome] of again) {
    const before = prepared.outcomes.get(ref);
    outcomes.set(ref, outcome);
    if (!before || isGone(before)) continue;
    if (isGone(outcome)) {
      goneRefs.add(before.ref);
      lost.push(names.get(before.hash) ?? before.hash);
    } else {
      swaps.set(before.ref, outcome.ref);
    }
  }
  const request = substituteRefs(prepared.request, swaps);
  // bytes the request needs that are gone now cannot be sent; the record's
  // pictures become unavailable
  if (refsIn(request).some((ref) => goneRefs.has(ref))) {
    throw new SubmitRefused({ kind: "stillMissing", names: lost });
  }
  return { submission, request, record: await recordOf(submission, request, outcomes), outcomes };
}

/** What a card knows of a job this page just sent. */
function sentFacts(domain: JobDomain, record: ReqRecordV2): JobFacts {
  return {
    domain,
    mine: true,
    routed: !stripDomain(domain),
    hasInputs: record.inputs !== null,
    missingRefs: 0,
    lost: 0,
    unavailable: record.unavailable?.length ?? 0,
    createdAt: Date.now(),
  };
}

function track(prepared: Prepared, job: Job): void {
  const { domain, mapKeys } = prepared.submission;
  useJobQueueStore
    .getState()
    .trackJob(job.id, domain, { request: prepared.request, mapKeys, priority: job.priority ?? 0 });
  if (prepared.record)
    queryClient.setQueryData(recordKey(job.id), sentFacts(domain, prepared.record));
  void queryClient.invalidateQueries({ queryKey: ["v2-jobs"] });
}

function refusal(err: unknown): unknown {
  if (!(err instanceof ApiError)) return err;
  if (err.status === 507) return new SubmitRefused({ kind: "full" }, { cause: err });
  if (err.status === 429) return new SubmitRefused({ kind: "busy" }, { cause: err });
  if (err.status === 413) return new SubmitRefused({ kind: "tooLarge" }, { cause: err });
  if (err.code === "already_submitted") {
    return new SubmitRefused({ kind: "removed" }, { cause: err });
  }
  return err;
}

/** Post a prepared job with its record and track it. A 422 for bytes the
 * server no longer holds sends them again once, under the same `submitId`.
 * Answers the job and the prepared form the post ended with. */
export async function post(
  prepared: Prepared,
  submitId: string,
): Promise<{ job: Job; prepared: Prepared }> {
  let current = prepared;
  for (let attempt = 0; ; attempt += 1) {
    if (!current.record) {
      const job = await api.post<Job>("/sdapi/v2/jobs", current.request).catch((err: unknown) => {
        throw refusal(err);
      });
      track(current, job);
      return { job, prepared: current };
    }
    try {
      const job = await api.post<Job>("/sdapi/v2/submit", {
        submit_id: submitId,
        job: current.request,
        record: current.record,
      });
      track(current, job);
      return { job, prepared: current };
    } catch (err) {
      const misses = missingHashes(err);
      if (misses && attempt === 0) {
        current = await resend(current, misses);
        continue;
      }
      if (misses) {
        const names = current.submission.batch.namesOf(misses);
        throw new SubmitRefused(
          { kind: "stillMissing", names: [...names.values()] },
          { cause: err },
        );
      }
      // the store went off after the page asked: a job that names no upload goes without a record
      if (err instanceof ApiError && err.code === "media_store_off") {
        if (refsIn(current.request).length === 0) {
          current = { ...current, record: null };
          continue;
        }
        throw new UploadRefused({ kind: "storeOff", message: err.detail?.message ?? STORE_OFF });
      }
      throw refusal(err);
    }
  }
}

/** Prepare, post and track: the one way a tracked job is sent. */
export async function submitJob(submission: Submission, submitId = newSubmitId()): Promise<Job> {
  return (await post(await prepare(submission), submitId)).job;
}
