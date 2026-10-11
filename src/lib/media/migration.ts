// What moving this browser's older records to the server does: the order the
// items go in, the ones the server's caps or its retention would refuse, the
// bodies they are sent with and what each answer means for the move.

import type { ReqEntryV2, ReqRecordPutV2 } from "@/api/types/media";
import type { JobRequest } from "@/api/types/v2";
import { readStoredInputs, type StoredEntry, type StoredJob } from "@/lib/inputs/stored";
import { stripDomain } from "@/lib/jobs/domains";
import { currentJobRequest } from "@/lib/retiredJobFields";
import { assembleEntry, type ThumbPart } from "./entry";
import { assembleRecord } from "./record";

const DAY = 24 * 60 * 60 * 1000;

/** The server retires every record of a browser whose newest record is older
 * than this. */
export const CLIENT_IDLE_MS = 90 * DAY;

export type MoveItem =
  | { kind: "entry"; id: string; entry: StoredEntry; cids: readonly string[] }
  | { kind: "record"; id: string; record: StoredJob; cids: readonly string[] };

export type EntryItem = Extract<MoveItem, { kind: "entry" }>;
export type RecordItem = Extract<MoveItem, { kind: "record" }>;

export type SkipReason =
  /** The server would retire the records at its next pass. */
  | { code: "idle" }
  | { code: "full"; kind: MoveItem["kind"]; cap: number; count: number }
  | { code: "refused"; status: number; reason: string };

export interface Skip {
  item: MoveItem;
  reason: SkipReason;
}

/** What the server holds that decides what it takes. */
export interface ServerRoom {
  library: { cap: number; unpinned: number; pins: number; maxPins: number };
  records: { cap: number; count: number; newest: number | null };
}

const byUse = (a: StoredEntry, b: StoredEntry) =>
  Number(b.pinned) - Number(a.pinned) ||
  b.usedAt - a.usedAt ||
  b.savedAt - a.savedAt ||
  a.id.localeCompare(b.id);

/** Entries first, pinned then the most recently used, then job records newest
 * first. What a cap would refuse is skipped before any byte goes, and records
 * are moved only while the server would keep them. */
export function planMigration(
  entries: readonly EntryItem[],
  records: readonly RecordItem[],
  room: ServerRoom,
  now: number,
): { items: MoveItem[]; skipped: Skip[] } {
  const items: MoveItem[] = [];
  const skipped: Skip[] = [];

  let { unpinned, pins } = room.library;
  const ordered = [...entries].sort((a, b) => byUse(a.entry, b.entry));
  for (const item of ordered) {
    const { entry } = item;
    // a trashed entry and a pin with room count toward no cap
    if (entry.trashedAt !== null) items.push(item);
    else if (entry.pinned && pins < room.library.maxPins) {
      pins += 1;
      items.push(item);
    } else if (unpinned < room.library.cap) {
      unpinned += 1;
      items.push(item);
    } else {
      skipped.push({
        item,
        reason: { code: "full", kind: "entry", cap: room.library.cap, count: unpinned },
      });
    }
  }

  const jobs = [...records].sort(
    (a, b) => b.record.createdAt - a.record.createdAt || a.id.localeCompare(b.id),
  );
  const newest = jobs.reduce(
    (latest, item) => Math.max(latest, Math.min(item.record.createdAt, now)),
    room.records.newest ?? 0,
  );
  const idle = now - newest >= CLIENT_IDLE_MS;
  let count = room.records.count;
  for (const item of jobs) {
    if (idle) skipped.push({ item, reason: { code: "idle" } });
    else if (count < room.records.cap) {
      count += 1;
      items.push(item);
    } else {
      skipped.push({
        item,
        reason: { code: "full", kind: "record", cap: room.records.cap, count },
      });
    }
  }
  return { items, skipped };
}

export interface EntryMoveParts {
  /** The hash on the server of each cid's bytes; a cid without one did not get there. */
  hashes: ReadonlyMap<string, string>;
  thumbs: readonly ThumbPart[];
  /** How long this browser kept what went to its trash. */
  localRetentionMs: number;
  /** How long the server keeps it. */
  serverRetentionMs: number;
  now: number;
}

/** An entry as an older build stored it, sent with every field it carried;
 * a trashed one keeps the time it had left. */
export function entryMoveBody(entry: StoredEntry, parts: EntryMoveParts): ReqEntryV2 {
  const clamp = (time: number) => Math.min(time, parts.now);
  const trashedAt =
    entry.trashedAt === null
      ? null
      : clamp(entry.trashedAt + parts.localRetentionMs - parts.serverRetentionMs);
  return assembleEntry({
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    inputs: entry.inputs,
    inputCids: readStoredInputs(entry.inputs).cids,
    maps: entry.maps,
    hashes: parts.hashes,
    thumbs: parts.thumbs,
    moved: {
      savedAt: clamp(entry.savedAt),
      usedAt: clamp(entry.usedAt),
      pinned: entry.pinned,
      trashedAt,
    },
  });
}

/** A job record as an older build stored it, under this browser's client id;
 * a job that never reaches a strip has nothing left to route. */
export function recordMoveBody(
  record: StoredJob,
  parts: { client: string; hashes: ReadonlyMap<string, string>; now: number },
): ReqRecordPutV2 {
  const request = currentJobRequest(record.request as unknown as JobRequest) as unknown as Record<
    string,
    unknown
  >;
  return {
    ...assembleRecord({
      client: parts.client,
      checkpoint: record.checkpoint,
      request,
      refs: record.refs,
      inputs: record.inputs,
      inputCids: record.inputs ? readStoredInputs(record.inputs).cids : [],
      mapKeys: record.mapKeys,
      maps: record.maps,
      hashes: parts.hashes,
    }),
    request,
    domain: record.domain,
    created_at: Math.min(record.createdAt, parts.now),
    routed: record.routed || !stripDomain(record.domain),
  };
}

/** What the server answered for one item. */
export type MoveAnswer =
  | { ok: true; unpinned: boolean }
  | {
      ok: false;
      status: number;
      code: string | null;
      /** The server's words, for a refusal the move skips. */
      reason: string;
      cap: number | null;
      count: number | null;
    }
  | { ok: false; network: true };

export type MoveStep =
  | { step: "moved"; unpinned: boolean }
  | { step: "skip"; reason: SkipReason }
  | { step: "stop"; status: number | null };

/** A refusal skips its item; a busy, full or unreachable server stops the
 * move, since every item after it would meet the same. */
export function stepOf(item: MoveItem, answer: MoveAnswer): MoveStep {
  if (answer.ok) return { step: "moved", unpinned: answer.unpinned };
  if ("network" in answer) return { step: "stop", status: null };
  const { status } = answer;
  if (status === 408 || status === 429 || status >= 500) return { step: "stop", status };
  if (status === 409 && (answer.code === "library_full" || answer.code === "records_full")) {
    return {
      step: "skip",
      reason: { code: "full", kind: item.kind, cap: answer.cap ?? 0, count: answer.count ?? 0 },
    };
  }
  return { step: "skip", reason: { code: "refused", status, reason: answer.reason } };
}
