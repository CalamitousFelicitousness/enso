import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResBlobV2, ResClaimV2 } from "@/api/types/media";
import type { BatchTools } from "./uploads";

/** The hash a fake server gives bytes: their text, as hex, to 64 digits. */
function hashOf(text: string): string {
  return Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0")
    .slice(0, 64);
}

/** A Blob whose file is gone, as a dropped file moved on disk. */
class BrokenBlob extends Blob {
  override slice(): Blob {
    return { arrayBuffer: () => Promise.reject(new Error("NotReadableError")) } as unknown as Blob;
  }
}

let uploads: typeof import("./uploads");
let UserAbortError: typeof import("@/lib/abort").UserAbortError;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("window", { location: { origin: "http://localhost:5174" } });
  uploads = await import("./uploads");
  ({ UserAbortError } = await import("@/lib/abort"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A server and a browser's stores for a batch, with what each was asked.
 * `rows` are pictures this browser sent before, as [cid, their bytes' text]. */
function fakes(options: { held?: string[]; room?: number; rows?: [string, string][] } = {}) {
  const held = new Set((options.held ?? []).map(hashOf));
  const rows = new Map(
    (options.rows ?? []).map(([cid, text]) => [cid, { hash: hashOf(text), size: text.length }]),
  );
  const stored = new Map<string, Blob>();
  const asked = { claims: [] as { hashes: string[]; bytes: number }[], sent: [] as string[] };
  let open = 0;
  let mostAtOnce = 0;
  let gate: Promise<void> = Promise.resolve();
  const tools: BatchTools = {
    claim: (hashes, bytes) => {
      asked.claims.push({ hashes: [...hashes], bytes });
      const answer: ResClaimV2 = {
        present: hashes.filter((h) => held.has(h)),
        missing: hashes.filter((h) => !held.has(h)),
        lost: [],
        // the room the test asks for, past the claimed bytes and a reserve of as much
        space: { ok: true, free: (options.room ?? 1e12) + bytes, needed: bytes * 2 },
      };
      return Promise.resolve(answer);
    },
    ingest: async (blob, { name, onProgress, signal } = {}) => {
      open += 1;
      mostAtOnce = Math.max(mostAtOnce, open);
      try {
        await new Promise<void>((resolve, reject) => {
          const stop = () => reject(new UserAbortError("stopped"));
          if (signal?.aborted) stop();
          signal?.addEventListener("abort", stop, { once: true });
          void gate.then(resolve);
        });
        const text = await blob.text();
        asked.sent.push(name ?? text);
        onProgress?.(blob.size);
        const hash = hashOf(text);
        const created = !held.has(hash);
        held.add(hash);
        const answer: ResBlobV2 = {
          hash,
          size: blob.size,
          type: "image/png",
          ext: "png",
          name: name ?? "",
          ref: `upload:${hash}`,
          url: "",
          created,
        };
        return answer;
      } finally {
        open -= 1;
      }
    },
    readHashes: (cids) =>
      Promise.resolve(
        new Map(cids.flatMap((cid) => (rows.has(cid) ? [[cid, rows.get(cid)!] as const] : []))),
      ),
    rememberHashes: (written) => {
      for (const [cid, hashed] of written) rows.set(cid, hashed);
      return Promise.resolve();
    },
    readBlob: (key) => Promise.resolve(stored.get(key) ?? null),
  };
  return {
    tools,
    asked,
    rows,
    stored,
    mostAtOnce: () => mostAtOnce,
    hold: () => {
      let release = () => {};
      gate = new Promise((resolve) => (release = resolve));
      return release;
    },
  };
}

describe("an upload batch", () => {
  it("claims first, with each remembered hash and the bytes the rest will take", async () => {
    const server = fakes({ held: ["old"], rows: [["cid-old", "old"]] });
    const batch = new uploads.UploadBatch("t", { tools: server.tools });
    const old = batch.stage(new Blob(["old"]), { name: "old.png", cid: "cid-old" });
    const fresh = batch.stage(new Blob(["fresh"]), { name: "fresh.png" });
    const outcomes = await batch.run();
    expect(server.asked.claims).toEqual([{ hashes: [hashOf("old")], bytes: 5 }]);
    expect(server.asked.sent).toEqual(["fresh.png"]);
    expect(outcomes.get(old.ref)).toEqual({
      ref: `upload:${hashOf("old")}`,
      hash: hashOf("old"),
      size: 3,
    });
    expect(outcomes.get(fresh.ref)).toMatchObject({ ref: `upload:${hashOf("fresh")}` });
  });

  it("sends remembered bytes again when the server no longer holds them", async () => {
    const server = fakes({ rows: [["cid-a", "a"]] });
    const batch = new uploads.UploadBatch("t", { tools: server.tools });
    batch.stage(new Blob(["a"]), { name: "a.png", cid: "cid-a" });
    await batch.run();
    expect(server.asked.sent).toEqual(["a.png"]);
  });

  it("remembers a picture by its cid, derived bytes by their key and a Blob by itself", async () => {
    const server = fakes();
    const blob = new Blob(["file"]);
    const first = new uploads.UploadBatch("t", { tools: server.tools });
    first.stage(new Blob(["pic"]), { name: "pic.png", cid: "cid-pic" });
    first.stage(new Blob(["comp"]), { name: "comp.png", key: "k", dims: { width: 8, height: 8 } });
    first.stage(blob, { name: "file.png" });
    await first.run();
    expect(server.rows.get("cid-pic")).toEqual({ hash: hashOf("pic"), size: 3 });
    expect(uploads.derivedFor("k")).toMatchObject({ hash: hashOf("comp"), width: 8, height: 8 });

    const make = vi.fn(() => Promise.resolve(new Blob(["comp"])));
    const second = new uploads.UploadBatch("t", { tools: server.tools });
    second.stage(new Blob(["pic"]), { name: "pic.png", cid: "cid-pic" });
    second.stage(make, { name: "comp.png", key: "k" });
    second.stage(blob, { name: "file.png" });
    await second.run();
    expect(server.asked.claims[1].hashes).toHaveLength(3);
    expect(server.asked.sent).toHaveLength(3);
    expect(make).not.toHaveBeenCalled();
  });

  it("sends two at a time", async () => {
    const server = fakes();
    const release = server.hold();
    const batch = new uploads.UploadBatch("t", { tools: server.tools });
    for (const name of ["a", "b", "c", "d"]) batch.stage(new Blob([name]), { name });
    const running = batch.run();
    await vi.waitFor(() => expect(server.mostAtOnce()).toBe(2));
    release();
    await running;
    expect(server.mostAtOnce()).toBe(2);
    expect([...server.asked.sent].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("stops every upload on cancel and rejects once", async () => {
    const server = fakes();
    server.hold();
    const controller = new AbortController();
    const batch = new uploads.UploadBatch("t", { tools: server.tools, signal: controller.signal });
    for (const name of ["a", "b", "c"]) batch.stage(new Blob([name]), { name });
    const running = batch.run();
    await vi.waitFor(() => expect(server.mostAtOnce()).toBe(2));
    controller.abort();
    await expect(running).rejects.toBeInstanceOf(UserAbortError);
    expect(server.asked.sent).toEqual([]);
  });

  it("refuses before any upload when the server has no room for the request", async () => {
    const server = fakes({ room: 2 });
    const batch = new uploads.UploadBatch("t", { tools: server.tools });
    batch.stage(new Blob(["toolarge"]), { name: "big.png" });
    await expect(batch.run()).rejects.toThrow("Not enough space on the server");
    expect(server.asked.sent).toEqual([]);
  });

  it("leaves out a record's pictures that do not fit, and sends the request's", async () => {
    const server = fakes({ room: 6 });
    const batch = new uploads.UploadBatch("t", { tools: server.tools });
    const request = batch.stage(new Blob(["req"]), { name: "req" });
    const kept = batch.stage(new Blob(["toobig"]), { name: "kept", record: true });
    const outcomes = await batch.run();
    expect(outcomes.get(request.ref)).toMatchObject({ hash: hashOf("req") });
    expect(outcomes.get(kept.ref)).toEqual({ gone: true });
  });

  it("is one item for the same cid, where a request's need outranks a record's", async () => {
    const server = fakes({ room: 2 });
    const batch = new uploads.UploadBatch("t", { tools: server.tools });
    const a = batch.stage(new Blob(["abc"]), { name: "a", cid: "cid-a", record: true });
    const b = batch.stage(new Blob(["abc"]), { name: "a", cid: "cid-a" });
    expect(b.ref).toBe(a.ref);
    // a record's picture would be left out; the request's is refused for space
    await expect(batch.run()).rejects.toThrow("Not enough space on the server");
  });

  it("reads a picture whose file is gone from its stored copy, else leaves it out of the record", async () => {
    const server = fakes();
    server.stored.set("cid-a", new Blob(["stored"]));
    const batch = new uploads.UploadBatch("t", { tools: server.tools });
    const healed = batch.stage(new BrokenBlob(["moved"]), {
      name: "a",
      cid: "cid-a",
      record: true,
    });
    const lost = batch.stage(new BrokenBlob(["gone"]), { name: "b", cid: "cid-b", record: true });
    const outcomes = await batch.run();
    expect(outcomes.get(healed.ref)).toMatchObject({ hash: hashOf("stored") });
    expect(outcomes.get(lost.ref)).toEqual({ gone: true });
  });

  it("refuses a request's file that can no longer be read, by its name", async () => {
    const server = fakes();
    const batch = new uploads.UploadBatch("t", { tools: server.tools });
    batch.stage(new BrokenBlob(["moved"]), { name: "cat.png" });
    await expect(batch.run()).rejects.toThrow("cat.png can no longer be read; add it again");
  });

  it("keeps going when the hashes cannot be remembered", async () => {
    const server = fakes();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const batch = new uploads.UploadBatch("t", {
      tools: {
        ...server.tools,
        rememberHashes: () => Promise.reject(new Error("QuotaExceededError")),
      },
    });
    const staged = batch.stage(new Blob(["a"]), { name: "a", cid: "cid-a" });
    expect((await batch.run()).get(staged.ref)).toMatchObject({ hash: hashOf("a") });
  });

  it("runs once, takes nothing after it starts, and makes no call when empty", async () => {
    const server = fakes();
    const empty = new uploads.UploadBatch("t", { tools: server.tools });
    expect((await empty.run()).size).toBe(0);
    expect(server.asked.claims).toEqual([]);
    const batch = new uploads.UploadBatch("t", { tools: server.tools });
    batch.stage(new Blob(["a"]), { name: "a" });
    const first = batch.run();
    expect(batch.run()).toBe(first);
    expect(() => batch.stage(new Blob(["b"]), { name: "b" })).toThrow();
    await first;
  });
});
