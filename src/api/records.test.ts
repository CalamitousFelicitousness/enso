import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PAGE = "http://localhost:5174";

let records: typeof import("./records");
let asked: URL[];
let answer: (url: URL) => Response;

const item = (id: string) => ({
  job_id: id,
  client: "c",
  user: null,
  domain: "generate",
  created_at: 1,
  routed: false,
  has_inputs: true,
  missing_refs: 0,
  lost: 0,
  unavailable: 0,
});

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("window", { location: { origin: PAGE } });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  asked = [];
  answer = (url) =>
    new Response(JSON.stringify({ records: url.searchParams.getAll("ids").map(item) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  vi.stubGlobal("fetch", (input: string) => {
    const url = new URL(input);
    asked.push(url);
    return Promise.resolve(answer(url));
  });
  records = await import("./records");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("recordItem", () => {
  it("asks once for every id asked within a tick, the key repeated", async () => {
    const [a, b, again] = await Promise.all([
      records.recordItem("j1"),
      records.recordItem("j2"),
      records.recordItem("j1"),
    ]);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.pathname).toBe("/sdapi/v2/records");
    expect(asked[0]?.searchParams.getAll("ids")).toEqual(["j1", "j2"]);
    expect(a?.job_id).toBe("j1");
    expect(b?.job_id).toBe("j2");
    expect(again).toEqual(a);
  });

  it("asks in chunks of 200", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `j${i}`);
    await Promise.all(ids.map((id) => records.recordItem(id)));
    expect(asked.map((url) => url.searchParams.getAll("ids").length)).toEqual([200, 200, 50]);
  });

  it("answers null for an id the server keeps no record of", async () => {
    answer = () =>
      new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    expect(await records.recordItem("gone")).toBeNull();
  });

  it("fails every id of a chunk whose read failed", async () => {
    answer = () => new Response("down", { status: 503 });
    const results = await Promise.allSettled([records.recordItem("a"), records.recordItem("b")]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
  });
});
