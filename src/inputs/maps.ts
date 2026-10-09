// The map cache: the maps processors made, by key, in the maps store of
// enso-inputs. A map is read when a frame first asks for its key and kept
// in memory from then on; a record expires a retention period after the map
// was last used, and the sweep drops it at page start. Beside the cache,
// which keys a job is making and which failed, for the outline.

import { create } from "zustand";
import {
  computeOutline,
  type Outline,
  type OutlineEnv,
  type ProcessingEnv,
} from "@/lib/inputs/outline";
import { MAP_SCHEMA, readMap, type ReadMap, type StoredMap } from "@/lib/inputs/stored";
import { MAPS } from "@/lib/inputs/storeLayout";
import type { Frame, Size } from "@/lib/inputs/types";
import type { ProcessorFacts } from "@/lib/processorUtils";
import { useJobQueueStore, type TrackedJob } from "@/stores/jobStore";
import { imageSize } from "./media";
import { readDocument, writeRecord } from "./db";
import { isQuotaError, reportFull } from "./quota";

export interface MapEntry {
  key: string;
  cid: string;
  blob: Blob;
  width: number;
  height: number;
  madeAt: number;
  /** When the record was last written as used. */
  usedAt: number;
}

export type PendingState = "queued" | "processing";

export interface MapsState {
  /** Maps the cache holds, by key. */
  current: ReadonlyMap<string, MapEntry>;
  /** Keys the store has been asked about, found or not. */
  lookedUp: ReadonlySet<string>;
  /** Keys a job is making. */
  pending: ReadonlyMap<string, PendingState>;
  /** Keys whose last run failed, with the reason. */
  failed: ReadonlyMap<string, string>;
  /** Counts every change, for consumers that key a cache on these facts. */
  stamp: number;
}

export const useMapStore = create<MapsState>()(() => ({
  current: new Map(),
  lookedUp: new Set(),
  pending: new Map(),
  failed: new Map(),
  stamp: 0,
}));

function change(apply: (s: MapsState) => Partial<MapsState>): void {
  useMapStore.setState((s) => ({ ...apply(s), stamp: s.stamp + 1 }));
}

/** What the outline needs to say where each map stands: the server's
 * processors, the cache as it is, and the sizes the pictures go out at. */
export function mapFacts(
  processors: ProcessorFacts,
  maps: MapsState,
  cloud: boolean,
  frame: Size,
  target: Size,
): ProcessingEnv {
  return {
    ...processors,
    current: maps.current,
    lookedUp: maps.lookedUp,
    pending: maps.pending,
    failed: maps.failed,
    stamp: maps.stamp,
    cloud,
    frame,
    target,
  };
}

/** The outline as a request sends it, once the cache has answered for every
 * map it names, so a stored map is sent rather than made again. Its keys name
 * the pictures placed in `frame` and drawn at `target`. */
export async function outlineWithMaps(
  frames: Frame[],
  processors: ProcessorFacts,
  options: { cloud: boolean; controlUnified: boolean; frame: Size; target: Size },
): Promise<Outline> {
  const { cloud, controlUnified, frame, target } = options;
  const env = () => ({
    controlUnified,
    processing: mapFacts(processors, useMapStore.getState(), cloud, frame, target),
  });
  const named = computeOutline(frames, env());
  await lookupMaps(named.entries.flatMap((e) => e.maps.map((m) => m.key)));
  return computeOutline(frames, env());
}

/** The maps the frames name that are current, once the cache has answered for
 * every key they name, so a stored map not read yet is not missed. */
export async function currentMapsOf(frames: Frame[], env: OutlineEnv): Promise<MapEntry[]> {
  const keys = new Set(
    computeOutline(frames, env).entries.flatMap((e) => e.maps.map((m) => m.key)),
  );
  await lookupMaps(keys);
  const { current } = useMapStore.getState();
  return [...keys].flatMap((key) => current.get(key) ?? []);
}

/** A record is written as used again at most this often. */
const TOUCH_MS = 24 * 60 * 60 * 1000;

function toRecord(entry: MapEntry): StoredMap {
  return {
    schema: MAP_SCHEMA,
    key: entry.key,
    cid: entry.cid,
    width: entry.width,
    height: entry.height,
    madeAt: entry.madeAt,
    usedAt: entry.usedAt,
  };
}

/** Keep the record of a map in use from expiring. Its bytes are stored; only
 * the record is written. */
function refresh(entry: MapEntry): MapEntry {
  const now = Date.now();
  if (now - entry.usedAt < TOUCH_MS) return entry;
  const used = { ...entry, usedAt: now };
  writeRecord(MAPS, entry.key, toRecord(used), new Map([[used.cid, used.blob]])).catch(
    (err: unknown) => console.error("[inputs] could not refresh a map record", err),
  );
  return used;
}

const reads = new Map<string, Promise<void>>();

async function readOne(key: string): Promise<void> {
  try {
    const stored = await readDocument<ReadMap>(MAPS, key, readMap, (read) => read.cids);
    const record = stored?.document.record;
    const blob = record ? stored.blobs.get(record.cid) : undefined;
    const entry: MapEntry | null =
      record && blob
        ? {
            key,
            cid: record.cid,
            blob,
            width: record.width,
            height: record.height,
            madeAt: record.madeAt,
            usedAt: record.usedAt,
          }
        : null;
    change((s) => ({
      lookedUp: new Set(s.lookedUp).add(key),
      ...(entry ? { current: new Map(s.current).set(key, refresh(entry)) } : {}),
    }));
  } catch (err) {
    // a map that cannot be read is made again: failed, with the reason, until then
    console.error("[inputs] could not read a cached map", err);
    markFailed({ [key]: "The stored map could not be read" });
  }
}

/** Ask the store about every key not asked about yet; resolves once every
 * key given has its answer. A key the store holds lands in `current`; any
 * key answered lands in `lookedUp`. */
export function lookupMaps(keys: Iterable<string>): Promise<void> {
  const waits: Promise<void>[] = [];
  for (const key of keys) {
    let read = reads.get(key);
    if (!read) {
      read = readOne(key);
      reads.set(key, read);
    }
    waits.push(read);
  }
  return Promise.all(waits).then(() => undefined);
}

/** The map for a key, when the cache holds it. */
export function currentMap(key: string): MapEntry | null {
  return useMapStore.getState().current.get(key) ?? null;
}

/** Keep a map a processor made. It is current from here on, whatever a job
 * or an earlier failure said about its key. A map whose bytes are stored
 * already, as a library entry's are, keeps its cid, so only its record is
 * written. */
export async function installMap(key: string, blob: Blob, cid?: string): Promise<void> {
  const { width, height } = await imageSize(blob);
  const now = Date.now();
  const entry: MapEntry = {
    key,
    cid: cid ?? crypto.randomUUID(),
    blob,
    width,
    height,
    madeAt: now,
    usedAt: now,
  };
  reads.set(key, Promise.resolve());
  change((s) => {
    const failed = new Map(s.failed);
    failed.delete(key);
    return {
      current: new Map(s.current).set(key, entry),
      lookedUp: new Set(s.lookedUp).add(key),
      failed,
    };
  });
  try {
    await writeRecord(MAPS, key, toRecord(entry), new Map([[entry.cid, blob]]));
  } catch (err) {
    console.error("[inputs] could not store a map", err);
    if (isQuotaError(err)) reportFull("A processed map");
  }
}

/** The map is being shown or sent: keep its record from expiring. */
export function touchMap(key: string): void {
  const entry = currentMap(key);
  if (!entry) return;
  const used = refresh(entry);
  if (used !== entry) change((s) => ({ current: new Map(s.current).set(key, used) }));
}

/** The maps the tracked jobs are making: queued while a job waits, being
 * processed while it runs. */
function pendingOf(jobs: ReadonlyMap<string, TrackedJob>): Map<string, PendingState> {
  const pending = new Map<string, PendingState>();
  for (const job of jobs.values()) {
    const state =
      job.status === "pending" ? "queued" : job.status === "running" ? "processing" : null;
    if (!state) continue;
    for (const key of job.mapKeys) {
      if (pending.get(key) !== "processing") pending.set(key, state);
    }
  }
  return pending;
}

/** Which jobs make maps, and how far each is: pending changes only with it. */
function jobsSignature(jobs: ReadonlyMap<string, TrackedJob>): string {
  return [...jobs.values()]
    .filter((j) => j.mapKeys.length > 0)
    .map((j) => `${j.id}:${j.status}`)
    .join(",");
}

/** Keep `pending` on the tracked jobs, so a job that ends any way (cancelled
 * while queued included) or comes back after a reload is reflected without
 * bookkeeping. Returns the unsubscribe. */
export function startPendingSync(): () => void {
  let last: string | null = null;
  const sync = (jobs: ReadonlyMap<string, TrackedJob>) => {
    const signature = jobsSignature(jobs);
    if (signature === last) return;
    last = signature;
    const pending = pendingOf(jobs);
    change(() => ({ pending }));
  };
  sync(useJobQueueStore.getState().jobs);
  return useJobQueueStore.subscribe((state, prev) => {
    if (state.jobs !== prev.jobs) sync(state.jobs);
  });
}

export function markFailed(failed: Record<string, string>): void {
  const entries = Object.entries(failed);
  if (entries.length === 0) return;
  change((s) => {
    const next = new Map(s.failed);
    for (const [key, reason] of entries) next.set(key, reason);
    return { failed: next };
  });
}
