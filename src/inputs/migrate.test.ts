import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntryItem, MoveAnswer, RecordItem } from "@/lib/media/migration";

const PAGE = "http://localhost:5174";
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

let migrate: typeof import("./migrate");
let UserAbortError: typeof import("@/lib/abort").UserAbortError;
let ApiError: typeof import("@/api/client").ApiError;
let UploadRefused: typeof import("@/api/blobs").UploadRefused;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("window", { location: { origin: PAGE } });
  vi.stubGlobal("localStorage", { getItem: () => "me", setItem: () => {} });
  migrate = await import("./migrate");
  ({ UserAbortError } = await import("@/lib/abort"));
  ({ ApiError } = await import("@/api/client"));
  ({ UploadRefused } = await import("@/api/blobs"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const inputs = { schema: 3, size: { width: 64, height: 64 }, sizeSource: null, frames: [] };

const entry = (id: string, usedAt = NOW - DAY): EntryItem => ({
  kind: "entry",
  id,
  cids: [],
  entry: {
    schema: 1,
    id,
    kind: "set",
    name: id,
    savedAt: usedAt,
    usedAt,
    pinned: false,
    trashedAt: null,
    inputs,
    maps: {},
  },
});

const record = (id: string, createdAt = NOW - DAY): RecordItem => ({
  kind: "record",
  id,
  cids: [],
  record: {
    schema: 1,
    id,
    domain: "generate",
    createdAt,
    checkpoint: null,
    request: { type: "generate" },
    refs: {},
    inputs: null,
    mapKeys: [],
    maps: {},
    routed: true,
  },
});

const TARGET = { server: "b:7855", root: "/store" };

/** A move over items held in memory, each answered as given, ok otherwise. */
function fake(
  items: { entries?: EntryItem[]; records?: RecordItem[] },
  answers: Record<string, MoveAnswer | ((signal: AbortSignal) => Promise<MoveAnswer>)> = {},
  patch: Partial<import("./migrate").MoveEnv> = {},
) {
  const sent: string[] = [];
  const forgotten: string[] = [];
  const targets: unknown[] = [];
  const entries = items.entries ?? [];
  const records = items.records ?? [];
  const env: import("./migrate").MoveEnv = {
    legacy: () =>
      Promise.resolve({
        entries,
        records,
        bytes: new Map([...entries, ...records].map((i) => [migrate.itemKey(i), 1000])),
      }),
    server: () =>
      Promise.resolve({
        room: {
          library: { cap: 100, unpinned: 0, pins: 0, maxPins: 20 },
          records: { cap: 200, count: 0, newest: NOW },
        },
        target: TARGET,
        serverRetentionMs: 7 * DAY,
      }),
    localRetentionMs: () => Promise.resolve(7 * DAY),
    moveOne: (item, context) => {
      sent.push(item.id);
      const answer = answers[item.id];
      if (typeof answer === "function") return answer(context.signal);
      return Promise.resolve(answer ?? { ok: true, unpinned: false });
    },
    forget: (item) => {
      forgotten.push(item.id);
      return Promise.resolve();
    },
    readTarget: () => Promise.resolve(null),
    writeTarget: (target) => {
      targets.push(target);
      return Promise.resolve();
    },
    exclusive: (run) => run(),
    now: () => NOW,
    ...patch,
  };
  return { env, sent, forgotten, targets };
}

const run = (env: import("./migrate").MoveEnv, signal = new AbortController().signal) =>
  migrate.runMove(env, signal, () => {});

describe("runMove", () => {
  it("deletes a legacy record only once the server took its copy", async () => {
    const { env, forgotten } = fake(
      { entries: [entry("a"), entry("b", NOW - 2 * DAY)], records: [record("r")] },
      { b: { ok: false, status: 413, code: null, reason: "too large", cap: null, count: null } },
    );
    const result = await run(env);
    expect(forgotten).toEqual(["a", "r"]);
    expect(result).toMatchObject({ kind: "done", moved: { entries: 1, records: 1 } });
    // the refused entry stays here, listed with why
    expect(result.kind === "done" && result.skipped.map((s) => [s.item.id, s.reason])).toEqual([
      ["b", { code: "refused", status: 413, reason: "too large" }],
    ]);
  });

  it("counts an entry the server already held, a move begun before, as moved", async () => {
    const { env, forgotten } = fake({ entries: [entry("a")] }, { a: { ok: true, unpinned: true } });
    const result = await run(env);
    expect(forgotten).toEqual(["a"]);
    expect(result).toMatchObject({ kind: "done", unpinned: 1, maxPins: 20 });
  });

  it("uploads nothing more for a kind the server says is full", async () => {
    const full: MoveAnswer = {
      ok: false,
      status: 409,
      code: "library_full",
      reason: "full",
      cap: 100,
      count: 100,
    };
    const { env, sent } = fake(
      { entries: [entry("a"), entry("b", NOW - 2 * DAY)], records: [record("r")] },
      { a: full },
    );
    const result = await run(env);
    expect(sent).toEqual(["a", "r"]);
    expect(result.kind === "done" && result.skipped.map((s) => s.item.id)).toEqual(["a", "b"]);
  });

  it("stops on a busy, full or unreachable server, keeping what moved and the target", async () => {
    const { env, forgotten, targets } = fake(
      { entries: [entry("a"), entry("b", NOW - 2 * DAY)] },
      { b: { ok: false, status: 507, code: null, reason: "full", cap: null, count: null } },
    );
    const result = await run(env);
    expect(result).toMatchObject({ kind: "stopped", status: 507, moved: { entries: 1 } });
    expect(forgotten).toEqual(["a"]);
    // a stopped move resumes toward the same server
    expect(targets).toEqual([TARGET]);
  });

  it("stops with the counts so far when cancelled", async () => {
    const controller = new AbortController();
    const { env, forgotten } = fake(
      { entries: [entry("a"), entry("b", NOW - 2 * DAY), entry("c", NOW - 3 * DAY)] },
      {
        b: () => {
          controller.abort();
          return Promise.reject(new UserAbortError());
        },
      },
    );
    const result = await run(env, controller.signal);
    expect(result).toMatchObject({ kind: "stopped", status: "cancelled", moved: { entries: 1 } });
    expect(forgotten).toEqual(["a"]);
  });

  it("clears the target once every item had its turn", async () => {
    const { env, targets } = fake({ entries: [entry("a")] });
    await run(env);
    expect(targets).toEqual([TARGET, null]);
  });

  it("refuses to run while another tab moves", async () => {
    const { env, sent } = fake(
      { entries: [entry("a")] },
      {},
      {
        exclusive: () => Promise.resolve("busy" as const),
      },
    );
    expect(await run(env)).toEqual({ kind: "busy" });
    expect(sent).toEqual([]);
  });

  it("refuses to resume toward another server, unless asked to", async () => {
    const other = { server: "a:7855", root: "/old" };
    const { env, sent } = fake(
      { entries: [entry("a")] },
      {},
      {
        readTarget: () => Promise.resolve(other),
      },
    );
    expect(await run(env)).toEqual({ kind: "otherTarget", from: other, to: TARGET });
    expect(sent).toEqual([]);
    const anyway = await migrate.runMove(env, new AbortController().signal, () => {}, {
      anyTarget: true,
    });
    expect(anyway).toMatchObject({ kind: "done", moved: { entries: 1 } });
  });

  it("reports progress by item and by the bytes each names", async () => {
    const seen: string[] = [];
    const { env } = fake({ entries: [entry("a")], records: [record("r")] });
    await migrate.runMove(env, new AbortController().signal, (p) =>
      seen.push(`${p.done}/${p.total} ${p.bytes}/${p.totalBytes}`),
    );
    expect(seen).toEqual(["0/2 0/2000", "1/2 1000/2000", "2/2 2000/2000"]);
  });
});

describe("answerOf", () => {
  it("reads a refusal's code and numbers", () => {
    const err = new ApiError(409, "Conflict", {
      error: "HTTPException",
      code: 409,
      detail: { code: "library_full", message: "The library is full", cap: 100, count: 100 },
    });
    expect(migrate.answerOf(err)).toEqual({
      ok: false,
      status: 409,
      code: "library_full",
      reason: "The library is full",
      cap: 100,
      count: 100,
    });
  });

  it("maps refused bytes onto the move's stop rules", () => {
    const status = (failure: ConstructorParameters<typeof UploadRefused>[0]) => {
      const answer = migrate.answerOf(new UploadRefused(failure));
      return "status" in answer ? answer.status : "network";
    };
    expect(status({ kind: "space", room: 1, needed: 2 })).toBe(507);
    expect(status({ kind: "busy" })).toBe(429);
    expect(status({ kind: "stalled" })).toBe(408);
    expect(status({ kind: "storeOff", message: "off" })).toBe(503);
    expect(status({ kind: "network" })).toBe("network");
    expect(migrate.answerOf(new TypeError("Failed to fetch"))).toEqual({
      ok: false,
      network: true,
    });
  });

  it("lets a cancel through", () => {
    expect(() => migrate.answerOf(new UserAbortError())).toThrow(UserAbortError);
  });
});
