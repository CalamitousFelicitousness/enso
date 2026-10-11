// What the server keeps of each job this browser tracks: a record under the
// job's id with the request as sent, where each upload came from, the frames
// it was built from and the hash of every picture they name. A result brings
// its inputs back from it, and a job is sent again from it. Records an older
// build kept in this browser are read as well until they are moved.

import { readRecord, routeRecord } from "@/api/records";
import type { JobRequest } from "@/api/types/v2";
import { readSnapshot, joinSnapshot, type ReadSnapshot } from "@/lib/inputs/stored";
import { SNAPSHOTS } from "@/lib/inputs/storeLayout";
import {
  joinInputs,
  readServerRecord,
  type Inputs,
  type JoinLoss,
  type Source,
  type StoredInputs,
  type StoredJob,
} from "@/lib/inputs/stored";
import type { JobDomain } from "@/lib/jobs/domains";
import { refsIn, replayNeeds, substituteRefs, UPLOAD_PREFIX } from "@/lib/jobs/replay";
import { hashOf, isHash } from "@/lib/media/hash";
import { currentJobRequest } from "@/lib/retiredJobFields";
import { generationHistoryDb } from "@/stores/generationStore";
import { allKeys, deleteRecords, readDocument, readHashes } from "./db";
import { bytesFor, type FetchOptions } from "./fetch";
import { legacyJob, markLegacyRouted } from "./legacyRecords";
import { emptyLedger, materialise, type HeldMaps, type SourceFrames } from "./materialise";
import type { Submission } from "./submit";
import type { UploadBatch } from "./uploads";

/** A job whose pictures went out without the uploader: its record keeps the
 * request and no frames. */
export function unrecordedSubmission(
  domain: JobDomain,
  request: JobRequest,
  batch: UploadBatch,
): Submission {
  return {
    domain,
    request,
    batch,
    ledger: emptyLedger(),
    inputs: null,
    mapKeys: [],
    checkpoint: null,
  };
}

/** A job's record as a restore and Run again read it. */
export interface RecordLoad {
  record: StoredJob;
  /** The hash of each cid's bytes, as far as anyone knows. */
  hashes: Readonly<Record<string, string>>;
  /** Refs of the request whose bytes the server no longer holds. */
  missingRefs: readonly string[];
  /** Cids whose bytes the server lost or never got. */
  unheld: ReadonlySet<string>;
  /** Read from an older build's record in this browser, not the server. */
  legacy: boolean;
}

/** Every cid stored inputs name, with the name the picture had. */
function namesOf(inputs: StoredInputs | null): Map<string, string> {
  const names = new Map<string, string>();
  for (const frame of inputs?.frames ?? []) {
    for (const p of frame.pictures) names.set(p.cid, p.name);
    for (const o of frame.mask.objects) names.set(o.cid, o.name);
    for (const m of frame.ipAdapter.masks) names.set(m.cid, m.name);
  }
  return names;
}

/** A job's record from the server, else from an older build in this browser;
 * null when neither keeps one. */
export async function loadRecord(id: string): Promise<RecordLoad | null> {
  const answer = await readRecord(id);
  if (answer) {
    return {
      record: readServerRecord(answer),
      hashes: answer.hashes,
      missingRefs: answer.missing_ref_ids,
      unheld: new Set([...answer.lost_cids, ...answer.unavailable_cids]),
      legacy: false,
    };
  }
  const record = await legacyJob(id);
  if (!record) return null;
  const cids = [...namesOf(record.inputs).keys(), ...Object.values(record.maps)];
  const rows = await readHashes(cids).catch(() => new Map<string, { hash: string }>());
  return {
    record,
    hashes: Object.fromEntries([...rows].map(([cid, row]) => [cid, row.hash])),
    // the claim tells which the server still holds
    missingRefs: refsIn(record.request),
    unheld: new Set(),
    legacy: true,
  };
}

/** What a source is called when its bytes cannot be sent. */
function sourceName(
  source: Source | undefined,
  names: ReadonlyMap<string, string>,
  inputs: StoredInputs | null,
): string {
  switch (source?.kind) {
    case "composite":
      return "input.png";
    case "mask":
      return "mask.png";
    case "map":
      return "map.png";
    case "file": {
      const frame = inputs?.frames.find((f) => f.id === source.frameId);
      const cid = frame?.pictures.find((p) => p.id === source.pictureId)?.cid;
      return (cid && names.get(cid)) ?? "picture";
    }
    case "ipMask": {
      const frame = inputs?.frames.find((f) => f.id === source.frameId);
      const cid = frame?.ipAdapter.masks.find((m) => m.id === source.maskId)?.cid;
      return (cid && names.get(cid)) ?? "mask";
    }
    default:
      return "picture";
  }
}

const NO_FRAMES: SourceFrames & { held: HeldMaps } = {
  frames: [],
  size: { width: 0, height: 0 },
  held: { cids: {}, blobs: new Map() },
};

/** A recorded job ready to send again. Every upload is staged under the hash
 * it went out with, so the claim decides: the server's copy goes as it is,
 * and one it lacks is made again from its source over the record's frames,
 * whose bytes are read, or fetched, only then. Every picture the record names
 * is staged to keep with the new record, which heals one the server lost and
 * this browser still holds. */
export function replaySubmission(
  load: RecordLoad,
  batch: UploadBatch,
  fetch: FetchOptions = {},
): Submission {
  const { record, hashes } = load;
  const request = currentJobRequest(record.request as unknown as JobRequest);
  const names = namesOf(record.inputs);
  const ledger = emptyLedger();
  let frames: Promise<SourceFrames & { held: HeldMaps }> | null = null;
  const framesOnce = () => {
    frames ??= (async () => {
      if (!record.inputs) return NO_FRAMES;
      const needs = replayNeeds(record).flatMap((n) =>
        n.cid.startsWith("missing:") ? [] : [n.cid],
      );
      const { blobs } = await bytesFor(needs, hashes, fetch);
      const { inputs } = joinInputs(record.inputs, blobs);
      return { frames: inputs.frames, size: inputs.size, held: { cids: record.maps, blobs } };
    })();
    return frames;
  };
  const swaps = new Map<string, string>();
  for (const ref of refsIn(request)) {
    const id = ref.slice(UPLOAD_PREFIX.length);
    const source = record.refs[ref];
    const make = source
      ? async () => {
          const from = await framesOnce();
          return (await materialise(source, from, from.held))?.blob ?? null;
        }
      : null;
    const staged = batch.stage(make, {
      name: sourceName(source, names, record.inputs),
      ...(isHash(id) ? { hash: id } : {}),
      ...(source ? { source } : {}),
    });
    if (source) ledger.refs[staged.ref] = source;
    swaps.set(ref, staged.ref);
  }
  const kept = new Map(names);
  for (const cid of Object.values(record.maps)) kept.set(cid, "map.png");
  for (const [cid, name] of kept) {
    const hash = hashOf(hashes, cid);
    const { ref } = batch.stage(null, { name, cid, record: true, ...(hash ? { hash } : {}) });
    ledger.cids.set(cid, ref);
  }
  ledger.maps = { ...record.maps };
  return {
    domain: record.domain,
    request: substituteRefs(request, swaps),
    batch,
    ledger,
    inputs: record.inputs,
    mapKeys: [...record.mapKeys],
    checkpoint: record.checkpoint,
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
 * record, fetched from the server where this browser lacks them, else from
 * the snapshot an older build kept beside the result; null when neither
 * holds any. */
export async function loadJobInputs(
  result: { jobId?: string | undefined; inputsKey?: string | undefined },
  fetch: FetchOptions = {},
): Promise<LoadedInputs | null> {
  if (result.jobId) {
    const load = await loadRecord(result.jobId);
    if (load) {
      const { record, hashes } = load;
      if (!record.inputs) return null;
      const cids = [...namesOf(record.inputs).keys(), ...Object.values(record.maps)];
      const { blobs } = await bytesFor(cids, hashes, fetch);
      const maps = new Map<string, { cid: string; blob: Blob }>();
      for (const [key, cid] of Object.entries(record.maps)) {
        const blob = blobs.get(cid);
        if (blob) maps.set(key, { cid, blob });
      }
      return { ...joinInputs(record.inputs, blobs), maps };
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
 * does not route it again. */
export async function markRouted(id: string): Promise<void> {
  if (await routeRecord(id)) return;
  await markLegacyRouted(id);
}

/** Delete the snapshots older builds kept beside results that no history row
 * names any more. Nothing goes when the history cannot be read. */
export async function retireSnapshots(): Promise<void> {
  let inputsKeys: Set<string>;
  try {
    const results = await generationHistoryDb.getAll();
    inputsKeys = new Set(results.flatMap((r) => (r.inputsKey ? [r.inputsKey] : [])));
  } catch (err) {
    console.error("[inputs] no snapshots retired: the history could not be read", err);
    return;
  }
  try {
    const unnamed = (await allKeys(SNAPSHOTS)).filter(
      (key): key is string => typeof key === "string" && !inputsKeys.has(key),
    );
    await deleteRecords(SNAPSHOTS, unnamed);
  } catch (err) {
    console.error("[inputs] could not retire snapshots", err);
  }
}
