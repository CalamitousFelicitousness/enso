import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResBlobV2, ResClaimV2 } from "@/api/types/media";
import type { JobRequest } from "@/api/types/v2";
import type { BatchTools } from "./uploads";

const PAGE = "http://localhost:5174";

function hashOf(text: string): string {
  return Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0")
    .slice(0, 64);
}

let submit: typeof import("./submit");
let uploads: typeof import("./uploads");
let jobStore: typeof import("@/stores/jobStore");
let emptyLedger: typeof import("./materialise").emptyLedger;

interface Posted {
  path: string;
  body: Record<string, unknown>;
}

let posted: Posted[];
let storeOn: boolean;
let answers: ((body: Record<string, unknown>) => Response)[];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const job = (id: string) => ({
  id,
  type: "generate",
  status: "pending",
  progress: 0,
  step: 0,
  steps: 0,
  eta: null,
  created_at: "2026-10-10T00:00:00Z",
  started_at: null,
  completed_at: null,
  error: null,
  result: null,
  priority: 3,
});

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("window", { location: { origin: PAGE } });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  posted = [];
  storeOn = true;
  answers = [];
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/sdapi/v2/server-info") {
      return Promise.resolve(
        json(200, { media_store: { enabled: storeOn, reason: storeOn ? null : "disk gone" } }),
      );
    }
    const text = typeof init?.body === "string" ? init.body : "{}";
    const body = JSON.parse(text) as Record<string, unknown>;
    posted.push({ path: url.pathname, body });
    const next = answers.shift();
    return Promise.resolve(next ? next(body) : json(202, job("job-1")));
  });
  submit = await import("./submit");
  uploads = await import("./uploads");
  jobStore = await import("@/stores/jobStore");
  ({ emptyLedger } = await import("./materialise"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A server holding no bytes at first, which notes what it was sent. */
function server() {
  const holds = new Set<string>();
  const sent: string[] = [];
  const tools: BatchTools = {
    claim: (hashes) => {
      const answer: ResClaimV2 = {
        present: hashes.filter((h) => holds.has(h)),
        missing: hashes.filter((h) => !holds.has(h)),
        lost: [],
        space: { ok: true, free: 1e12, needed: 0 },
      };
      return Promise.resolve(answer);
    },
    ingest: async (blob, { name } = {}) => {
      const text = await blob.text();
      sent.push(name ?? text);
      const hash = hashOf(text);
      holds.add(hash);
      const answer: ResBlobV2 = {
        hash,
        size: blob.size,
        type: "image/png",
        ext: "png",
        name: name ?? "",
        ref: `upload:${hash}`,
        url: "",
        created: true,
      };
      return answer;
    },
    readHashes: () => Promise.resolve(new Map()),
    rememberHashes: () => Promise.resolve(),
    readBlob: () => Promise.resolve(null),
  };
  return { tools, sent, forget: (text: string) => holds.delete(hashOf(text)) };
}

/** A generation whose request names one picture, which its record keeps too. */
function submission(tools: BatchTools) {
  const batch = new uploads.UploadBatch("t", { tools });
  const ledger = emptyLedger();
  const { ref } = batch.stage(new Blob(["cat"]), { name: "cat.png", cid: "cid-cat" });
  ledger.refs[ref] = { kind: "file", frameId: "f1", pictureId: "p1" };
  ledger.cids.set("cid-cat", ref);
  const request = { type: "generate", prompt: "a cat", inputs: [ref] } as unknown as JobRequest;
  return {
    domain: "generate" as const,
    request,
    batch,
    ledger,
    inputs: null,
    mapKeys: [],
    checkpoint: null,
  };
}

describe("a job and its record", () => {
  it("go in one post, every ref real, and the job is tracked with the server's priority", async () => {
    const { tools } = server();
    const prepared = await submit.prepare(submission(tools));
    const { job: sent } = await submit.post(prepared, "a".repeat(32));
    expect(posted).toHaveLength(1);
    const [{ path, body }] = posted as [Posted];
    expect(path).toBe("/sdapi/v2/submit");
    expect(body["submit_id"]).toBe("a".repeat(32));
    expect(JSON.stringify(body)).not.toContain("staged:");
    expect((body["job"] as { inputs: string[] }).inputs).toEqual([`upload:${hashOf("cat")}`]);
    expect((body["record"] as { refs: object }).refs).toEqual({
      [`upload:${hashOf("cat")}`]: { kind: "file", frameId: "f1", pictureId: "p1" },
    });
    expect(sent.id).toBe("job-1");
    expect(jobStore.useJobQueueStore.getState().jobs.get("job-1")?.priority).toBe(3);
  });

  it("send again, once and under the same id, the bytes the server says it no longer holds", async () => {
    const store = server();
    const prepared = await submit.prepare(submission(store.tools));
    store.forget("cat");
    answers = [
      () =>
        json(422, {
          detail: [
            {
              type: "upload_missing",
              loc: ["body", "job", "inputs", 0],
              msg: "missing",
              input: `upload:${hashOf("cat")}`,
            },
          ],
        }),
    ];
    await submit.post(prepared, "b".repeat(32));
    expect(posted.map((p) => p.body["submit_id"])).toEqual(["b".repeat(32), "b".repeat(32)]);
    expect(store.sent).toEqual(["cat.png", "cat.png"]);
  });

  it("name the files the server still lacks after a second try", async () => {
    const { tools } = server();
    const prepared = await submit.prepare(submission(tools));
    const missing = () =>
      json(422, {
        detail: [{ type: "upload_missing", loc: [], msg: "", input: hashOf("cat") }],
      });
    answers = [missing, missing];
    await expect(submit.post(prepared, "c".repeat(32))).rejects.toThrow(
      "The server does not hold cat.png after a second try",
    );
  });

  it("say a job queued before and removed since was not queued again", async () => {
    const { tools } = server();
    const prepared = await submit.prepare(submission(tools));
    answers = [
      () =>
        json(409, {
          error: "HTTPException",
          code: 409,
          detail: { code: "already_submitted", message: "gone", job_id: "old" },
        }),
    ];
    await expect(submit.post(prepared, "d".repeat(32))).rejects.toThrow(
      "This job was queued before and has since been removed",
    );
  });
});

describe("with the media store off", () => {
  it("sends a job that names no picture without a record", async () => {
    storeOn = false;
    const batch = new uploads.UploadBatch("t", { tools: server().tools });
    const prepared = await submit.prepare({
      domain: "generate",
      request: { type: "generate", prompt: "a cat" } as unknown as JobRequest,
      batch,
      ledger: emptyLedger(),
      inputs: null,
      mapKeys: [],
      checkpoint: null,
    });
    expect(prepared.record).toBeNull();
    await submit.post(prepared, "e".repeat(32));
    expect(posted.map((p) => p.path)).toEqual(["/sdapi/v2/jobs"]);
  });

  it("refuses a job that names a picture, with the reason", async () => {
    storeOn = false;
    const store = server();
    await expect(submit.prepare(submission(store.tools))).rejects.toThrow("disk gone");
    expect(store.sent).toEqual([]);
  });
});
