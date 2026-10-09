// What this browser keeps of each job it sends: a record in the jobs store of
// enso-inputs under the server's job id, holding the request as sent, where
// each of its uploads came from and the frames it was built from. A result
// brings its inputs back from it, and a job is sent again from it with fresh
// uploads. Records are retired by count, never while a result or a live job
// names them.

import { useEffect } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { api } from "@/api/client";
import { queryClient } from "@/api/queryClient";
import type { Job, JobRequest } from "@/api/types/v2";
import { JOBS, JOBS_BY_CREATION, SNAPSHOTS } from "@/lib/inputs/storeLayout";
import { createIdbListDb, type IdbListDb } from "@/lib/idbListDb";
import { loose } from "@/lib/inputs/loose";
import {
  JOB_SCHEMA,
  joinInputs,
  joinSnapshot,
  readJob,
  readSnapshot,
  splitJob,
  type Inputs,
  type JobRecord,
  type JoinLoss,
  type ReadJob,
  type ReadSnapshot,
  type StoredInputs,
  type StoredJob,
} from "@/lib/inputs/stored";
import { holdsContent } from "@/lib/inputs/types";
import type { JobFacts } from "@/lib/jobs/cardActions";
import { isTerminal, jobKind, type JobDomain } from "@/lib/jobs/domains";
import { replayNeeds, replayProblem } from "@/lib/jobs/replay";
import { awaitsRouting, JOB_RECORDS_CAP, newestFirst } from "@/lib/jobs/retention";
import { planTrim } from "@/lib/trim";
import { RECORD_FAILED, RECORD_FAILED_DETAIL } from "@/lib/jobs/text";
import { generationHistoryDb } from "@/stores/generationStore";
import { useJobQueueStore } from "@/stores/jobStore";
import { videoHistoryDb } from "@/stores/videoStore";
import {
  allKeys,
  deleteRecords,
  indexEntries,
  readAllRecords,
  readDocument,
  readRecords,
  updateRecord,
  writeRecord,
} from "./db";
import { ReplayError, type Ledger, type SourceFrames } from "./materialise";

/** The frames a job was built from, when they hold anything to bring back. */
export function keptInputs(inputs: Inputs): Inputs | null {
  return inputs.frames.some(holdsContent) ? inputs : null;
}

/** A job whose pictures went out without the uploader: its record keeps the
 * request, and the job cannot be sent again from it. */
export function unrecordedSubmission(domain: JobDomain, request: JobRequest): Submission {
  return {
    domain,
    request,
    ledger: { refs: {}, maps: {}, blobs: new Map() },
    inputs: null,
    mapKeys: [],
    checkpoint: null,
  };
}

/** A job as a builder made it, ready to send. */
export interface Submission {
  domain: JobDomain;
  request: JobRequest;
  /** Where each upload the request names came from. */
  ledger: Ledger;
  /** The frames the request was built from, or as an earlier record stored
   * them; null when they held nothing. */
  inputs: Inputs | StoredInputs | null;
  /** The maps the job makes before generating. */
  mapKeys: string[];
  checkpoint: StoredJob["checkpoint"];
}

interface FactsState {
  /** What each record says, by job id. */
  facts: ReadonlyMap<string, JobFacts>;
  /** Every stored record has been read once. */
  loaded: boolean;
}

export const useJobFacts = create<FactsState>()(() => ({ facts: new Map(), loaded: false }));

function factsOf(record: StoredJob): JobFacts {
  return {
    domain: record.domain,
    hasInputs: record.inputs !== null,
    replay: replayProblem(record),
    routed: record.routed,
  };
}

function setFacts(record: StoredJob): void {
  useJobFacts.setState((s) => ({ facts: new Map(s.facts).set(record.id, factsOf(record)) }));
}

function dropFacts(ids: readonly string[]): void {
  if (ids.length === 0) return;
  useJobFacts.setState((s) => {
    const facts = new Map(s.facts);
    for (const id of ids) facts.delete(id);
    return { facts };
  });
}

/** What this browser's record says about a job; null while not read yet or
 * when there is none. Reads the records once per page when first asked. */
export function useJobFact(id: string | null | undefined): JobFacts | null {
  useEffect(() => {
    void loadJobFacts();
  }, []);
  return useJobFacts((s) => (id ? (s.facts.get(id) ?? null) : null));
}

let factsRead: Promise<void> | null = null;

/** Read what every stored record says, once per page; writers keep it current after. */
export function loadJobFacts(): Promise<void> {
  factsRead ??= (async () => {
    const facts = new Map<string, JobFacts>();
    try {
      for (const [key, value] of await readAllRecords(JOBS)) {
        try {
          const { record } = readJob(value);
          facts.set(record.id, factsOf(record));
        } catch (err) {
          console.warn("[inputs] a job record could not be read", key, err);
        }
      }
    } catch (err) {
      console.error("[inputs] could not read the job records", err);
    }
    // what writers set while this read ran is newer
    useJobFacts.setState((s) => ({ facts: new Map([...facts, ...s.facts]), loaded: true }));
  })();
  return factsRead;
}

/** Store a job's record. A record this build could not read back is not
 * written: it would stop every sweep. */
async function recordJob(job: JobRecord, maps: ReadonlyMap<string, Blob>): Promise<void> {
  const { record, blobs } = splitJob(job);
  readJob(record);
  for (const [cid, blob] of maps) blobs.set(cid, blob);
  await writeRecord(JOBS, record.id, record, blobs);
  setFacts(record);
}

/** Tracking opens the job's socket, and a job that has already ended replays
 * its end there and routes its result, which names the record; the record is
 * waited for this long at most. */
const RECORD_WAIT_MS = 2000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Send a job, keep its record and track it. The one way a tracked job is sent. */
export async function submitJob(submission: Submission): Promise<Job> {
  const { domain, request, ledger, inputs, mapKeys, checkpoint } = submission;
  const job = await api.post<Job>("/sdapi/v2/jobs", request);
  const record: JobRecord = {
    id: job.id,
    domain,
    createdAt: Date.now(),
    checkpoint,
    request,
    refs: ledger.refs,
    inputs,
    mapKeys,
    maps: ledger.maps,
    routed: false,
  };
  const written = recordJob(record, ledger.blobs).catch((err: unknown) => {
    console.error("[inputs] could not store a job's record", err);
    toast.warning(RECORD_FAILED, { description: RECORD_FAILED_DETAIL });
  });
  await Promise.race([written, delay(RECORD_WAIT_MS)]);
  const priority = (request as { priority?: number }).priority ?? 0;
  useJobQueueStore.getState().trackJob(job.id, domain, { request, mapKeys, priority });
  void queryClient.invalidateQueries({ queryKey: ["v2-jobs"] });
  scheduleRetirement();
  return job;
}

/** A job's record without its bytes; null when this browser has none. */
export async function loadJob(id: string): Promise<StoredJob | null> {
  const stored = await readDocument<ReadJob>(JOBS, id, readJob, () => []);
  return stored?.document.record ?? null;
}

export interface ReplayLoad {
  record: StoredJob;
  /** The record's frames with the bytes its uploads are made from. */
  inputs: SourceFrames;
  /** The bytes read with the record, by cid. */
  held: ReadonlyMap<string, Blob>;
}

const NO_FRAMES: SourceFrames = { frames: [], size: { width: 0, height: 0 } };

/** A record with only the bytes sending it again reads; null when this
 * browser has none. Throws ReplayError when one of those bytes is gone. */
export async function loadJobForReplay(id: string): Promise<ReplayLoad | null> {
  const stored = await readDocument<ReadJob>(JOBS, id, readJob, (read) =>
    replayNeeds(read.record).map((n) => n.cid),
  );
  if (!stored) return null;
  const { record } = stored.document;
  const missing = replayNeeds(record).find((n) => !stored.blobs.has(n.cid));
  if (missing) throw new ReplayError(missing.what);
  const joined = record.inputs ? joinInputs(record.inputs, stored.blobs).inputs : null;
  return {
    record,
    inputs: joined ? { frames: joined.frames, size: joined.size } : NO_FRAMES,
    held: stored.blobs,
  };
}

export interface LoadedInputs {
  inputs: Inputs;
  lost: JoinLoss;
  /** The maps the job sent as pictures, by key, with their bytes. */
  maps: ReadonlyMap<string, { cid: string; blob: Blob }>;
}

const NO_MAPS: LoadedInputs["maps"] = new Map();

/** The frames a result's job was sent with, with their bytes: from the job's
 * record, else from the snapshot an older build kept beside the result; null
 * when neither holds any. */
export async function loadJobInputs(result: {
  jobId?: string | undefined;
  inputsKey?: string | undefined;
}): Promise<LoadedInputs | null> {
  if (result.jobId) {
    const stored = await readDocument<ReadJob>(JOBS, result.jobId, readJob, (read) => read.cids);
    const record = stored?.document.record;
    if (stored && record) {
      if (!record.inputs) return null;
      const maps = new Map<string, { cid: string; blob: Blob }>();
      for (const [key, cid] of Object.entries(record.maps)) {
        const blob = stored.blobs.get(cid);
        if (blob) maps.set(key, { cid, blob });
      }
      return { ...joinInputs(record.inputs, stored.blobs), maps };
    }
  }
  if (result.inputsKey) {
    const stored = await readDocument<ReadSnapshot>(
      SNAPSHOTS,
      result.inputsKey,
      readSnapshot,
      (read) => read.cids,
    );
    if (stored) {
      const { frames, size, lost } = joinSnapshot(stored.document.record, stored.blobs);
      return { inputs: { frames, size, sizeSource: null }, lost, maps: NO_MAPS };
    }
  }
  return null;
}

/** The job's result has reached the strip, or never will: a later page start
 * does not route it again. Nothing is written for a record that is missing
 * or unreadable. */
export async function markRouted(id: string): Promise<void> {
  const marked: StoredJob[] = [];
  await updateRecord(JOBS, id, (raw) => {
    const { record } = readJob(raw);
    if (record.routed) return null;
    const next = readJob({ ...record, routed: true }).record;
    marked.push(next);
    return next;
  });
  for (const record of marked) setFacts(record);
}

let retiring: Promise<void> | null = null;
let retireAgain = false;

/** Delete the records past the newest JOB_RECORDS_CAP that no history row,
 * live job or pending routing names, and the snapshots of older builds no
 * history row names. Nothing goes when a history cannot be read. */
export function retireJobRecords(): Promise<void> {
  if (retiring) {
    retireAgain = true;
    return retiring;
  }
  retiring = (async () => {
    do {
      retireAgain = false;
      await retireOnce();
    } while (retireAgain);
  })().finally(() => {
    retiring = null;
  });
  return retiring;
}

let retireTimer: ReturnType<typeof setTimeout> | undefined;

/** One retirement after a run of submits. */
function scheduleRetirement(): void {
  clearTimeout(retireTimer);
  retireTimer = setTimeout(() => void retireJobRecords(), 3000);
}

async function retireOnce(): Promise<void> {
  const keep = new Set<string>();
  const inputsKeys = new Set<string>();
  try {
    const [results, videos] = await Promise.all([
      generationHistoryDb.getAll(),
      videoHistoryDb.getAll(),
    ]);
    for (const result of results) {
      keep.add(result.id);
      if (result.inputsKey) inputsKeys.add(result.inputsKey);
    }
    for (const video of videos) keep.add(video.id);
  } catch (err) {
    console.error("[inputs] no job records retired: the history could not be read", err);
    return;
  }
  for (const job of useJobQueueStore.getState().jobs.values()) {
    if (!isTerminal(job.status)) keep.add(job.id);
  }
  try {
    const summaries = (await indexEntries(JOBS, JOBS_BY_CREATION)).flatMap((e) =>
      typeof e.primaryKey === "string" && typeof e.key === "number"
        ? [{ id: e.primaryKey, createdAt: e.key }]
        : [],
    );
    const candidates = planTrim(summaries, JOB_RECORDS_CAP, keep, newestFirst);
    if (candidates.length > 0) {
      const now = Date.now();
      const records = await readRecords(JOBS, candidates);
      const retired = candidates.filter((id) => {
        const raw = records.get(id);
        if (raw === undefined) return false;
        try {
          return !awaitsRouting(readJob(raw).record, now);
        } catch {
          // a record this build cannot read is left as it is
          return false;
        }
      });
      await deleteRecords(JOBS, retired);
      dropFacts(retired);
    }
    const snapshots = (await allKeys(SNAPSHOTS)).filter(
      (key): key is string => typeof key === "string" && !inputsKeys.has(key),
    );
    await deleteRecords(SNAPSHOTS, snapshots);
  } catch (err) {
    console.error("[inputs] could not retire job records", err);
  }
}

/** What an older build kept of each job it tracked, in a database of its own. */
interface LegacyPayload {
  id: string;
  request: unknown;
  createdAt: number;
  snapshot: { inputsKey?: string; mapKeys?: string[] };
}

const LEGACY_PAYLOADS = "SDNextJobPayloads";
let legacyPayloads: Promise<IdbListDb<LegacyPayload> | null> | null = null;

/** The older build's payload store, when this browser has one; opened once,
 * never created. */
function openLegacyPayloads(): Promise<IdbListDb<LegacyPayload> | null> {
  legacyPayloads ??= indexedDB
    .databases()
    .then((dbs) =>
      dbs.some((db) => db.name === LEGACY_PAYLOADS)
        ? createIdbListDb<LegacyPayload>({
            dbName: LEGACY_PAYLOADS,
            storeName: "payloads",
            sortKey: "createdAt",
          })
        : null,
    )
    .catch(() => null);
  return legacyPayloads;
}

/** A job an older build sent and was still tracking when this build opened:
 * its payload becomes a record, with the frames its snapshot kept, so it is
 * tracked and routed like any other. Null when that build kept none. */
export async function adoptLegacyJob(id: string): Promise<StoredJob | null> {
  const payloads = await openLegacyPayloads();
  const payload = payloads ? loose<LegacyPayload>(await payloads.get(id)) : null;
  const request = loose<Record<string, unknown>>(payload?.request);
  const domain = typeof request?.["type"] === "string" ? jobKind(request["type"]).domain : null;
  if (!payload || !request || !domain) return null;
  const snapshot = loose<LegacyPayload["snapshot"]>(payload.snapshot);
  const inputsKey = typeof snapshot?.inputsKey === "string" ? snapshot.inputsKey : null;
  const kept = inputsKey
    ? await readDocument<ReadSnapshot>(SNAPSHOTS, inputsKey, readSnapshot, () => [])
    : null;
  const snap = kept?.document.record;
  const mapKeys = Array.isArray(snapshot?.mapKeys)
    ? snapshot.mapKeys.filter((k): k is string => typeof k === "string")
    : [];
  // The frames stay as the snapshot stored them; their bytes are already there
  const { record } = readJob({
    schema: JOB_SCHEMA,
    id,
    domain,
    createdAt: typeof payload.createdAt === "number" ? payload.createdAt : Date.now(),
    checkpoint: null,
    request: JSON.parse(JSON.stringify(request)),
    refs: {},
    inputs: snap
      ? { schema: snap.schema, size: snap.size, sizeSource: null, frames: snap.frames }
      : null,
    mapKeys,
    maps: {},
    routed: false,
  });
  await writeRecord(JOBS, id, record, new Map());
  setFacts(record);
  return record;
}
