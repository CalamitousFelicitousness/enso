import { describe, expect, it } from "vitest";
import { frame, picture } from "@/lib/inputs/frames.fixture";
import {
  ENTRY_SCHEMA,
  JOB_SCHEMA,
  storedInputsOf,
  type StoredEntry,
  type StoredJob,
} from "@/lib/inputs/stored";
import {
  CLIENT_IDLE_MS,
  entryMoveBody,
  planMigration,
  recordMoveBody,
  stepOf,
  type EntryItem,
  type RecordItem,
  type ServerRoom,
} from "./migration";
import { NAME_MAX } from "./entry";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const inputs = storedInputsOf({
  size: { width: 640, height: 448 },
  sizeSource: null,
  frames: [frame("f", "reference", picture("a"))],
});

const entry = (id: string, patch: Partial<StoredEntry> = {}): EntryItem => ({
  kind: "entry",
  id,
  cids: ["cid-a"],
  entry: {
    schema: ENTRY_SCHEMA,
    id,
    kind: "frame",
    name: id,
    savedAt: NOW - 10 * DAY,
    usedAt: NOW - 5 * DAY,
    pinned: false,
    trashedAt: null,
    inputs,
    maps: {},
    ...patch,
  },
});

const record = (id: string, createdAt: number, patch: Partial<StoredJob> = {}): RecordItem => ({
  kind: "record",
  id,
  cids: [],
  record: {
    schema: JOB_SCHEMA,
    id,
    domain: "generate",
    createdAt,
    checkpoint: null,
    request: { type: "generate", prompt: "a cat" },
    refs: {},
    inputs: null,
    mapKeys: [],
    maps: {},
    routed: true,
    ...patch,
  },
});

const room = (
  library: Partial<ServerRoom["library"]> = {},
  records: Partial<ServerRoom["records"]> = {},
): ServerRoom => ({
  library: { cap: 100, unpinned: 0, pins: 0, maxPins: 20, ...library },
  records: { cap: 200, count: 0, newest: null, ...records },
});

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);
const skippedIds = (skipped: readonly { item: { id: string } }[]) => skipped.map((s) => s.item.id);

describe("planMigration", () => {
  it("moves entries first, pinned then the most recently used, then records newest first", () => {
    const plan = planMigration(
      [
        entry("a", { usedAt: NOW - 5 * DAY }),
        entry("b", { pinned: true, usedAt: NOW - 9 * DAY }),
        entry("c", { usedAt: NOW - DAY }),
      ],
      [record("r1", NOW - 3 * DAY), record("r2", NOW - DAY)],
      room(),
      NOW,
    );
    expect(ids(plan.items)).toEqual(["b", "c", "a", "r2", "r1"]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips what a cap would refuse before anything is sent", () => {
    const plan = planMigration(
      [
        entry("used", { usedAt: NOW - DAY }),
        entry("older", { usedAt: NOW - 5 * DAY }),
        entry("trashed", { trashedAt: NOW - DAY }),
        entry("pinned", { pinned: true }),
      ],
      [record("new", NOW - DAY), record("old", NOW - 2 * DAY)],
      room({ cap: 2, unpinned: 1, pins: 20 }, { cap: 2, count: 1 }),
      NOW,
    );
    // the pin finds no room among the pins and takes the one place left
    expect(ids(plan.items)).toEqual(["pinned", "trashed", "new"]);
    expect(skippedIds(plan.skipped)).toEqual(["used", "older", "old"]);
    expect(plan.skipped[0].reason).toEqual({ code: "full", kind: "entry", cap: 2, count: 2 });
    expect(plan.skipped[2].reason).toEqual({ code: "full", kind: "record", cap: 2, count: 2 });
  });

  it("moves no record once this browser's newest is past the server's 90 days", () => {
    const old = [record("r1", NOW - CLIENT_IDLE_MS - DAY), record("r2", NOW - CLIENT_IDLE_MS)];
    const idle = planMigration([], old, room(), NOW);
    expect(idle.items).toEqual([]);
    expect(idle.skipped.map((s) => s.reason)).toEqual([{ code: "idle" }, { code: "idle" }]);
    // a recent record on the server keeps the browser's records
    const kept = planMigration([], old, room({}, { newest: NOW - DAY }), NOW);
    expect(ids(kept.items)).toEqual(["r2", "r1"]);
    // as does a recent one among them; a record from the future counts as now
    const mixed = planMigration([], [...old, record("r3", NOW + DAY)], room(), NOW);
    expect(ids(mixed.items)).toEqual(["r3", "r2", "r1"]);
  });

  it("resumes from the items left after a move stopped", () => {
    const entries = [entry("a"), entry("b", { usedAt: NOW - DAY }), entry("c", { pinned: true })];
    const records = [record("r1", NOW - DAY)];
    const first = planMigration(entries, records, room(), NOW);
    // the first two went, and their records left this browser
    const moved = new Set(ids(first.items.slice(0, 2)));
    const again = planMigration(
      entries.filter((e) => !moved.has(e.id)),
      records,
      room({ unpinned: 1, pins: 1 }),
      NOW,
    );
    expect(ids(again.items)).toEqual(ids(first.items.slice(2)));
  });
});

describe("entryMoveBody", () => {
  it("carries every stored field, its times clamped and its name trimmed", () => {
    const { entry: stored } = entry("e1", {
      name: `  ${"x".repeat(NAME_MAX + 10)}`,
      savedAt: NOW + DAY,
      usedAt: NOW - DAY,
      pinned: true,
      maps: { k1: "m1", k2: "m2" },
    });
    const body = entryMoveBody(stored, {
      hashes: new Map([
        ["cid-a", "a".repeat(64)],
        ["m1", "b".repeat(64)],
      ]),
      thumbs: [{ cid: "cid-a", thumb: "c".repeat(64), width: 32, height: 32 }],
      localRetentionMs: 7 * DAY,
      serverRetentionMs: 7 * DAY,
      now: NOW,
    });
    expect(body).toMatchObject({
      id: "e1",
      kind: "frame",
      migrating: true,
      saved_at: NOW,
      used_at: NOW - DAY,
      pinned: true,
      trashed_at: null,
      maps: { k1: "m1" },
      unavailable: [],
      summary: { frames: 1, pictures: 1, role: "reference", width: 640, height: 448 },
    });
    expect([...body.name]).toHaveLength(NAME_MAX);
    expect(body.thumbs).toHaveLength(1);
  });

  it("keeps the time a trashed entry had left under the server's retention", () => {
    const { entry: stored } = entry("e1", { trashedAt: NOW - 5 * DAY });
    const body = entryMoveBody(stored, {
      hashes: new Map(),
      thumbs: [],
      localRetentionMs: 7 * DAY,
      serverRetentionMs: 30 * DAY,
      now: NOW,
    });
    // two days were left here, and two are left on the server
    expect(body.trashed_at).toBe(NOW - 28 * DAY);
    expect(body.unavailable).toEqual(["cid-a"]);
  });
});

describe("recordMoveBody", () => {
  it("sends a record under this browser's id, its request as the server takes it", () => {
    const { record: stored } = record("j1", NOW + DAY, {
      request: { type: "generate", prompt: "a cat", pag_scale: 2 },
      routed: false,
    });
    const body = recordMoveBody(stored, { client: "browser-1", hashes: new Map(), now: NOW });
    expect(body).toMatchObject({
      client: "browser-1",
      domain: "generate",
      created_at: NOW,
      routed: false,
      inputs: null,
      unavailable: [],
    });
    expect(body.request).toEqual({ type: "generate", prompt: "a cat", cfg_true: 2 });
  });

  it("marks a job that reaches no strip as routed", () => {
    const { record: stored } = record("j1", NOW - DAY, {
      domain: "upscale",
      request: { type: "upscale" },
      routed: false,
    });
    expect(recordMoveBody(stored, { client: "b", hashes: new Map(), now: NOW }).routed).toBe(true);
  });
});

describe("stepOf", () => {
  const item = entry("e1");
  const refused = (status: number, code: string | null = null) =>
    stepOf(item, { ok: false, status, code, reason: "why", cap: 100, count: 100 });

  it("moves on an answer that took the item", () => {
    expect(stepOf(item, { ok: true, unpinned: true })).toEqual({ step: "moved", unpinned: true });
  });

  it("skips an item the server refused, and says a full kind is full", () => {
    expect(refused(409, "library_full")).toEqual({
      step: "skip",
      reason: { code: "full", kind: "entry", cap: 100, count: 100 },
    });
    expect(refused(413)).toEqual({
      step: "skip",
      reason: { code: "refused", status: 413, reason: "why" },
    });
    expect(refused(422, "unhashed_cid")).toMatchObject({ step: "skip" });
  });

  it("stops the move when the server is busy, full, off or out of reach", () => {
    for (const status of [408, 429, 500, 503, 507]) {
      expect(refused(status)).toEqual({ step: "stop", status });
    }
    expect(stepOf(item, { ok: false, network: true })).toEqual({ step: "stop", status: null });
  });
});
