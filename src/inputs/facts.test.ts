import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredJob } from "@/lib/inputs/stored";

const PAGE = "http://localhost:5174";

let facts: typeof import("./facts");
let records: Record<string, unknown>[];

const item = (id: string, client: string) => ({
  job_id: id,
  client,
  user: null,
  domain: "generate",
  created_at: 1,
  routed: false,
  has_inputs: true,
  missing_refs: 1,
  lost: 0,
  unavailable: 2,
});

const legacy: StoredJob = {
  schema: 1,
  id: "old",
  domain: "generate",
  createdAt: 1,
  checkpoint: null,
  request: { inputs: ["upload:a", "upload:b"] },
  refs: {},
  inputs: null,
  mapKeys: [],
  maps: {},
  routed: true,
};

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("window", { location: { origin: PAGE } });
  // this browser's client id, as an earlier page kept it
  vi.stubGlobal("localStorage", { getItem: () => "me", setItem: () => {} });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  records = [];
  vi.stubGlobal("fetch", (input: string) => {
    const ids = new URL(input).searchParams.getAll("ids");
    const body = { records: records.filter((r) => ids.includes(String(r["job_id"]))) };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  facts = await import("./facts");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a job's facts", () => {
  it("come from the server's record, which says whether this browser sent it", async () => {
    records = [item("mine", "me"), item("theirs", "other")];
    expect(await facts.loadFacts("mine")).toEqual({
      domain: "generate",
      mine: true,
      routed: false,
      hasInputs: true,
      missingRefs: 1,
      lost: 0,
      unavailable: 2,
      createdAt: 1,
    });
    expect((await facts.loadFacts("theirs"))?.mine).toBe(false);
  });

  it("come from an older build's record while it waits to be moved", async () => {
    const found = await facts.loadFacts("old", (id) =>
      Promise.resolve(id === "old" ? legacy : null),
    );
    expect(found).toMatchObject({ mine: true, routed: true, hasInputs: false, missingRefs: 2 });
    expect(await facts.loadFacts("none", () => Promise.resolve(null))).toBeNull();
  });

  it("are none for a domain this build does not know", async () => {
    records = [{ ...item("odd", "me"), domain: "teleport" }];
    expect(await facts.loadFacts("odd", () => Promise.resolve(null))).toBeNull();
  });
});
