// Moving this browser's older records to the server: the library entries and
// job records older builds kept here, one item at a time. A legacy record is
// deleted only once the server answered for its copy, so a move that stops
// resumes from what is left. One tab moves at a time, and a move that stopped
// resumes only toward the server it started with.

import { create } from "zustand";
import { toast } from "sonner";
import { api, ApiError } from "@/api/client";
import { UploadRefused } from "@/api/blobs";
import { queryClient } from "@/api/queryClient";
import { LIBRARY_KEY, MY_RECORDS_KEY } from "@/api/queryKeys";
import type {
  ResEntryChangeV2,
  ResLibraryV2,
  ResMediaReportV2,
  ResMediaSettingsV2,
  ResRecordsV2,
} from "@/api/types/media";
import { UserAbortError } from "@/lib/abort";
import { entryThumbs } from "@/lib/inputs/library";
import { readEntry, readJob, type StoredInputs } from "@/lib/inputs/stored";
import { JOBS, LIBRARY } from "@/lib/inputs/storeLayout";
import { sweepPolicy } from "@/lib/inputs/sweep";
import type { ThumbPart } from "@/lib/media/entry";
import {
  entryMoveBody,
  planMigration,
  recordMoveBody,
  stepOf,
  type EntryItem,
  type MoveAnswer,
  type MoveItem,
  type RecordItem,
  type ServerRoom,
  type Skip,
} from "@/lib/media/migration";
import { isGone, type Outcome } from "@/lib/media/stage";
import {
  CANCEL,
  MOVE,
  MOVE_HERE,
  MOVING_ELSEWHERE,
  moveOfferText,
  moveStoppedText,
  movedAllText,
  movingText,
  NOT_NOW,
  otherTargetText,
} from "@/lib/media/text";
import { clientId } from "./client";
import { deleteRecords, readAllRecords, readBlobs, readMeta, readTrashDays, writeMeta } from "./db";
import { missingHashes } from "./submit";
import { thumbBlob } from "./thumbs";
import { UploadBatch } from "./uploads";

const DAY = 24 * 60 * 60 * 1000;

/** The server a move goes to: the API base the page talks to, and the store's root. */
export interface MoveTarget {
  server: string;
  root: string | null;
}

const sameTarget = (a: MoveTarget, b: MoveTarget) => a.server === b.server && a.root === b.root;
const targetText = (t: MoveTarget) => (t.root ? `${t.server} (${t.root})` : t.server);

export interface MoveProgress {
  done: number;
  total: number;
  bytes: number;
  totalBytes: number;
}

export interface Moved {
  entries: number;
  records: number;
}

export type MoveResult =
  | { kind: "done"; moved: Moved; unpinned: number; maxPins: number; skipped: Skip[] }
  | {
      kind: "stopped";
      status: number | null | "cancelled";
      moved: Moved;
      unpinned: number;
      skipped: Skip[];
    }
  | { kind: "busy" }
  | { kind: "otherTarget"; from: MoveTarget; to: MoveTarget };

/** The readable records older builds kept here, and the bytes each names. */
export interface Legacy {
  entries: EntryItem[];
  records: RecordItem[];
  bytes: ReadonlyMap<string, number>;
}

export const itemKey = (item: Pick<MoveItem, "kind" | "id">) => `${item.kind}:${item.id}`;

export interface MoveContext {
  signal: AbortSignal;
  localRetentionMs: number;
  serverRetentionMs: number;
  now: number;
}

/** What a move reaches outside its own rules. */
export interface MoveEnv {
  legacy(): Promise<Legacy>;
  server(): Promise<{ room: ServerRoom; target: MoveTarget; serverRetentionMs: number }>;
  localRetentionMs(): Promise<number>;
  /** Send one item; a refusal is an answer, a cancel throws UserAbortError. */
  moveOne(item: MoveItem, context: MoveContext): Promise<MoveAnswer>;
  /** Delete the item's record from this browser. */
  forget(item: MoveItem): Promise<void>;
  readTarget(): Promise<MoveTarget | null>;
  writeTarget(target: MoveTarget | null): Promise<void>;
  /** Run while no other tab moves; "busy" when one does. */
  exclusive<T>(run: () => Promise<T>): Promise<T | "busy">;
  now(): number;
}

/** Move what is left, in the planned order, until done, stopped or cancelled. */
export async function runMove(
  env: MoveEnv,
  signal: AbortSignal,
  onProgress: (progress: MoveProgress) => void,
  options: { anyTarget?: boolean } = {},
): Promise<MoveResult> {
  const result = await env.exclusive(async (): Promise<MoveResult> => {
    const { room, target, serverRetentionMs } = await env.server();
    const started = await env.readTarget();
    if (started && !sameTarget(started, target) && !options.anyTarget) {
      return { kind: "otherTarget", from: started, to: target };
    }
    const [legacy, localRetentionMs] = await Promise.all([env.legacy(), env.localRetentionMs()]);
    const plan = planMigration(legacy.entries, legacy.records, room, env.now());
    const skipped = [...plan.skipped];
    const moved: Moved = { entries: 0, records: 0 };
    let unpinned = 0;
    const progress: MoveProgress = {
      done: 0,
      total: plan.items.length,
      bytes: 0,
      totalBytes: plan.items.reduce((n, item) => n + (legacy.bytes.get(itemKey(item)) ?? 0), 0),
    };
    if (plan.items.length > 0) await env.writeTarget(target);
    onProgress({ ...progress });
    const full = new Map<MoveItem["kind"], Skip["reason"]>();
    const stopped = (status: number | null | "cancelled"): MoveResult => ({
      kind: "stopped",
      status,
      moved,
      unpinned,
      skipped,
    });
    for (const item of plan.items) {
      if (signal.aborted) return stopped("cancelled");
      const fullReason = full.get(item.kind);
      if (fullReason) skipped.push({ item, reason: fullReason });
      else {
        let answer: MoveAnswer;
        try {
          answer = await env.moveOne(item, {
            signal,
            localRetentionMs,
            serverRetentionMs,
            now: env.now(),
          });
        } catch (err) {
          if (err instanceof UserAbortError || signal.aborted) return stopped("cancelled");
          throw err;
        }
        const step = stepOf(item, answer);
        if (step.step === "stop") return stopped(step.status);
        if (step.step === "skip") {
          skipped.push({ item, reason: step.reason });
          if (step.reason.code === "full") full.set(item.kind, step.reason);
        } else {
          await env.forget(item);
          if (item.kind === "entry") moved.entries += 1;
          else moved.records += 1;
          if (step.unpinned) unpinned += 1;
        }
      }
      progress.done += 1;
      progress.bytes += legacy.bytes.get(itemKey(item)) ?? 0;
      onProgress({ ...progress });
    }
    await env.writeTarget(null);
    return { kind: "done", moved, unpinned, maxPins: room.library.maxPins, skipped };
  });
  return result === "busy" ? { kind: "busy" } : result;
}

/** The server's answer to a refused request, or the batch's for refused bytes. */
export function answerOf(err: unknown): MoveAnswer {
  if (err instanceof UserAbortError) throw err;
  if (err instanceof UploadRefused) {
    const { failure } = err;
    const status =
      failure.kind === "space" || failure.kind === "full"
        ? 507
        : failure.kind === "busy"
          ? 429
          : failure.kind === "stalled"
            ? 408
            : failure.kind === "storeOff"
              ? 503
              : null;
    return status === null
      ? { ok: false, network: true }
      : { ok: false, status, code: null, reason: err.message, cap: null, count: null };
  }
  if (err instanceof ApiError) {
    const detail = err.detail;
    const num = (value: unknown) => (typeof value === "number" ? value : null);
    return {
      ok: false,
      status: err.status,
      code: err.code,
      reason: detail?.message ?? err.message,
      cap: num(detail?.["cap"]),
      count: num(detail?.["count"]),
    };
  }
  return { ok: false, network: true };
}

// The real move

const META_TARGET = "migrateTarget";
const META_SILENCED = "migrateSilencedUntil";
const SILENCE_MS = 7 * DAY;

/** File names for a frame set's bytes, by cid, for the server's downloads. */
function namesOf(inputs: StoredInputs): Map<string, string> {
  const names = new Map<string, string>();
  for (const frame of inputs.frames) {
    for (const picture of frame.pictures) names.set(picture.cid, picture.name);
    for (const object of frame.mask.objects) names.set(object.cid, object.name);
  }
  return names;
}

/** Stage every cid the item names, with the bytes this browser still holds. */
function stageAll(
  batch: UploadBatch,
  cids: readonly string[],
  blobs: ReadonlyMap<string, Blob>,
  names: ReadonlyMap<string, string>,
): Map<string, string> {
  const refs = new Map<string, string>();
  for (const cid of cids) {
    refs.set(
      cid,
      batch.stage(blobs.get(cid) ?? null, { name: names.get(cid) ?? `${cid}.png`, cid }).ref,
    );
  }
  return refs;
}

function hashesOf(
  refs: ReadonlyMap<string, string>,
  outcomes: ReadonlyMap<string, Outcome>,
): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const [cid, ref] of refs) {
    const outcome = outcomes.get(ref);
    if (outcome && !isGone(outcome)) hashes.set(cid, outcome.hash);
  }
  return hashes;
}

/** Run a batch, post, and send once more what the server said it lacks. */
async function sendWith<T>(
  batch: UploadBatch,
  post: (outcomes: ReadonlyMap<string, Outcome>) => Promise<T>,
): Promise<T> {
  let outcomes = await batch.run();
  try {
    return await post(outcomes);
  } catch (err) {
    const misses = missingHashes(err);
    if (!misses) throw err;
    outcomes = new Map([...outcomes, ...(await batch.again({}, misses).run())]);
    return post(outcomes);
  }
}

async function moveEntry(item: EntryItem, context: MoveContext): Promise<MoveAnswer> {
  const blobs = await readBlobs([...item.cids]);
  const batch = new UploadBatch("Move to the server", { signal: context.signal });
  const refs = stageAll(batch, item.cids, blobs, namesOf(item.entry.inputs));
  const thumbRefs = new Map<string, { ref: string; width: number; height: number }>();
  for (const picture of entryThumbs(item.entry).pictures) {
    const file = blobs.get(picture.cid);
    if (!file) continue;
    const thumb = await thumbBlob({
      cid: picture.cid,
      file,
      width: picture.width,
      height: picture.height,
    }).catch(() => null);
    if (!thumb) continue;
    const { ref } = batch.stage(thumb, { name: `${picture.name}.webp` });
    thumbRefs.set(picture.cid, { ref, width: picture.width, height: picture.height });
  }
  try {
    const answer = await sendWith(batch, (outcomes) => {
      const thumbs: ThumbPart[] = [];
      for (const [cid, t] of thumbRefs) {
        const outcome = outcomes.get(t.ref);
        if (outcome && !isGone(outcome)) {
          thumbs.push({ cid, thumb: outcome.hash, width: t.width, height: t.height });
        }
      }
      return api.post<ResEntryChangeV2>(
        "/sdapi/v2/library",
        entryMoveBody(item.entry, { ...context, hashes: hashesOf(refs, outcomes), thumbs }),
      );
    });
    return { ok: true, unpinned: answer.unpinned };
  } catch (err) {
    return answerOf(err);
  }
}

async function moveRecord(item: RecordItem, context: MoveContext): Promise<MoveAnswer> {
  const blobs = await readBlobs([...item.cids]);
  const batch = new UploadBatch("Move to the server", { signal: context.signal });
  const refs = stageAll(
    batch,
    item.cids,
    blobs,
    item.record.inputs ? namesOf(item.record.inputs) : new Map(),
  );
  const client = await clientId();
  try {
    await sendWith(batch, (outcomes) =>
      api.put(
        `/sdapi/v2/records/${encodeURIComponent(item.id)}`,
        recordMoveBody(item.record, { client, hashes: hashesOf(refs, outcomes), now: context.now }),
      ),
    );
    return { ok: true, unpinned: false };
  } catch (err) {
    return answerOf(err);
  }
}

/** The readable records older builds kept here, with the bytes each names. */
export async function readLegacy(): Promise<Legacy> {
  const [library, jobs] = await Promise.all([readAllRecords(LIBRARY), readAllRecords(JOBS)]);
  const entries: EntryItem[] = [];
  const records: RecordItem[] = [];
  for (const [key, value] of library) {
    try {
      const { record, cids } = readEntry(value);
      if (key === record.id) entries.push({ kind: "entry", id: record.id, entry: record, cids });
    } catch {
      // an entry this build cannot read stays listed with Delete
    }
  }
  for (const [key, value] of jobs) {
    try {
      const { record, cids } = readJob(value);
      if (key === record.id) records.push({ kind: "record", id: record.id, record, cids });
    } catch {
      // a record this build cannot read stays where it is
    }
  }
  const all = [...entries, ...records];
  const blobs = await readBlobs([...new Set(all.flatMap((item) => item.cids))]);
  const bytes = new Map<string, number>();
  for (const item of all) {
    bytes.set(
      itemKey(item),
      item.cids.reduce((n, cid) => n + (blobs.get(cid)?.size ?? 0), 0),
    );
  }
  return { entries, records, bytes };
}

async function serverState(): Promise<{
  room: ServerRoom;
  target: MoveTarget;
  serverRetentionMs: number;
  free: number | null;
}> {
  const client = await clientId();
  const [library, records, settings, report] = await Promise.all([
    api.get<ResLibraryV2>("/sdapi/v2/library"),
    api.get<ResRecordsV2>("/sdapi/v2/records", { client }),
    api.get<ResMediaSettingsV2>("/sdapi/v2/media/settings"),
    api.get<ResMediaReportV2>("/sdapi/v2/media"),
  ]);
  return {
    room: {
      library: {
        cap: library.cap,
        unpinned: library.entries.filter((e) => !e.pinned).length,
        pins: library.pins.count,
        maxPins: library.pins.max,
      },
      records: {
        cap: settings.record_cap,
        count: records.records.length,
        newest: records.records.reduce<number | null>(
          (latest, r) => (latest === null || r.created_at > latest ? r.created_at : latest),
          null,
        ),
      },
    },
    target: { server: new URL(api.getBaseUrl()).host, root: report.root ?? null },
    serverRetentionMs: sweepPolicy(settings.trash_days).removalMs,
    free: report.free ?? null,
  };
}

function readTarget(value: unknown): MoveTarget | null {
  if (typeof value !== "object" || value === null) return null;
  const { server, root } = value as { server?: unknown; root?: unknown };
  return typeof server === "string" && (typeof root === "string" || root === null)
    ? { server, root }
    : null;
}

const REAL_ENV: MoveEnv = {
  legacy: readLegacy,
  server: serverState,
  localRetentionMs: async () => sweepPolicy(await readTrashDays()).removalMs,
  moveOne: (item, context) =>
    item.kind === "entry" ? moveEntry(item, context) : moveRecord(item, context),
  forget: (item) => deleteRecords(item.kind === "entry" ? LIBRARY : JOBS, [item.id]),
  readTarget: async () => readTarget(await readMeta(META_TARGET).catch(() => null)),
  writeTarget: (target) => writeMeta(META_TARGET, target),
  exclusive: (run) =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request("enso-migrate", { ifAvailable: true }, (lock) =>
          lock ? run() : ("busy" as const),
        )
      : run(),
  now: () => Date.now(),
};

// The move as the page shows it

/** What still waits to move, as the offer counts it. */
export interface Waiting {
  entries: number;
  records: number;
  bytes: number;
  target: MoveTarget;
  free: number | null;
}

interface MigrationState {
  /** The readable records older builds kept here. */
  held: { entries: number; records: number };
  /** What a move would send now; null until counted or while nothing waits. */
  waiting: Waiting | null;
  progress: MoveProgress | null;
  /** Items the last move left here, by item key, with why. */
  skipped: ReadonlyMap<string, Skip>;
  controller: AbortController | null;
}

export const useMigration = create<MigrationState>()(() => ({
  waiting: null,
  held: { entries: 0, records: 0 },
  progress: null,
  skipped: new Map(),
  controller: null,
}));

// Separate ids: sonner merges an update into the toast it replaces, buttons and all
const OFFER_TOAST = "migrate-offer";
const PROGRESS_TOAST = "migrate";
const RESULT_TOAST = "migrate-result";
const TARGET_TOAST = "migrate-target";

/** Count what a move would send now, as the offer and the status line say it. */
export async function countWaiting(): Promise<Waiting | null> {
  const [legacy, server] = await Promise.all([readLegacy(), serverState()]);
  const present = new Set([...legacy.entries, ...legacy.records].map(itemKey));
  const plan = planMigration(legacy.entries, legacy.records, server.room, Date.now());
  // a reason a move gave stays while its item is still here
  const skipped = new Map([...useMigration.getState().skipped].filter(([key]) => present.has(key)));
  for (const skip of plan.skipped) skipped.set(itemKey(skip.item), skip);
  const waiting: Waiting = {
    entries: plan.items.filter((i) => i.kind === "entry").length,
    records: plan.items.filter((i) => i.kind === "record").length,
    bytes: plan.items.reduce((n, item) => n + (legacy.bytes.get(itemKey(item)) ?? 0), 0),
    target: server.target,
    free: server.free,
  };
  const any = waiting.entries + waiting.records > 0;
  useMigration.setState({
    waiting: any ? waiting : null,
    held: { entries: legacy.entries.length, records: legacy.records.length },
    skipped,
  });
  return any ? waiting : null;
}

function refresh(): void {
  void queryClient.invalidateQueries({ queryKey: LIBRARY_KEY });
  void queryClient.invalidateQueries({ queryKey: MY_RECORDS_KEY });
}

/** Offer the move once, unless Not now was chosen in the last seven days. */
export async function offerMove(): Promise<void> {
  const waiting = await countWaiting().catch((err: unknown) => {
    console.warn("[inputs] could not count what waits to move", err);
    return null;
  });
  if (!waiting) return;
  const silenced = await readMeta(META_SILENCED).catch(() => null);
  if (typeof silenced === "number" && silenced > Date.now()) return;
  const text = moveOfferText(
    waiting.entries,
    waiting.records,
    waiting.target,
    waiting.bytes,
    waiting.free,
  );
  toast(text.title, {
    id: OFFER_TOAST,
    duration: Infinity,
    description: text.description,
    action: { label: MOVE, onClick: () => void startMove() },
    cancel: {
      label: NOT_NOW,
      onClick: () => void writeMeta(META_SILENCED, Date.now() + SILENCE_MS),
    },
  });
}

/** Move what waits, with progress and Cancel in the notice. */
export async function startMove(options: { anyTarget?: boolean } = {}): Promise<void> {
  if (useMigration.getState().controller) return;
  const controller = new AbortController();
  useMigration.setState({ controller, progress: null });
  toast.dismiss(OFFER_TOAST);
  const cancel = { label: CANCEL, onClick: () => controller.abort() };
  try {
    const result = await runMove(
      REAL_ENV,
      controller.signal,
      (progress) => {
        useMigration.setState({ progress });
        toast.loading(
          movingText(progress.done, progress.total, progress.bytes, progress.totalBytes),
          { id: PROGRESS_TOAST, duration: Infinity, action: cancel },
        );
      },
      options,
    );
    toast.dismiss(PROGRESS_TOAST);
    if (result.kind === "busy") {
      toast.info(MOVING_ELSEWHERE, { id: RESULT_TOAST });
      return;
    }
    if (result.kind === "otherTarget") {
      toast.warning(otherTargetText(targetText(result.from), targetText(result.to)), {
        id: TARGET_TOAST,
        duration: Infinity,
        action: {
          label: MOVE_HERE,
          onClick: () => void startMove({ anyTarget: true }),
        },
      });
      return;
    }
    const skipped = new Map(result.skipped.map((skip) => [itemKey(skip.item), skip]));
    useMigration.setState({ skipped });
    const movedCount = result.moved.entries + result.moved.records;
    if (result.kind === "stopped") {
      const text = moveStoppedText(result.status, movedCount);
      toast.warning(text.title, {
        id: RESULT_TOAST,
        description: text.description,
        duration: 10_000,
      });
    } else {
      const text = movedAllText(result.moved, result.unpinned, result.maxPins, skipped.size);
      toast.success(text.title, {
        id: RESULT_TOAST,
        description: text.description ?? undefined,
        duration: 10_000,
      });
    }
  } catch (err) {
    console.error("[inputs] the move stopped", err);
    toast.dismiss(PROGRESS_TOAST);
    const text = moveStoppedText(null, 0);
    toast.error(text.title, { id: RESULT_TOAST, description: text.description });
  } finally {
    useMigration.setState({ controller: null, progress: null });
    refresh();
    void countWaiting().catch(() => null);
  }
}

/** Delete items the move left here from this browser for good. */
export async function deleteFromBrowser(items: readonly MoveItem[]): Promise<void> {
  const entries = items.filter((i) => i.kind === "entry").map((i) => i.id);
  const records = items.filter((i) => i.kind === "record").map((i) => i.id);
  if (entries.length > 0) await deleteRecords(LIBRARY, entries);
  if (records.length > 0) await deleteRecords(JOBS, records);
  const skipped = new Map(useMigration.getState().skipped);
  for (const item of items) skipped.delete(itemKey(item));
  useMigration.setState({ skipped });
  refresh();
  void countWaiting().catch(() => null);
}
