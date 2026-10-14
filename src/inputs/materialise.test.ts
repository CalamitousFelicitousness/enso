import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResBlobV2, ResClaimV2 } from "@/api/types/media";
import { frame, layer, maskObject, picture } from "@/lib/inputs/frames.fixture";
import type { Frame, Size } from "@/lib/inputs/types";
import type { MakeTools } from "./materialise";
import type { BatchTools } from "./uploads";

const SIZE: Size = { width: 64, height: 64 };

function hashOf(text: string): string {
  return Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0")
    .slice(0, 64);
}

let materialise: typeof import("./materialise");
let uploads: typeof import("./uploads");

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("window", { location: { origin: "http://localhost:5174" } });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  materialise = await import("./materialise");
  uploads = await import("./uploads");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A server that holds the hashes of `held` texts, and counts what it was sent. */
function server(held: string[] = []) {
  const holds = new Set(held.map(hashOf));
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

/** Making bytes without a canvas: a flatten, a mask export and a redraw that
 * count their calls; every file sends as itself unless `redrawn` names it. */
function makers(redrawn: string[] = []) {
  const calls = { flatten: 0, exportMask: 0, fit: [] as string[] };
  const tools: Partial<MakeTools> = {
    fit: async (blob, _size, fit) => {
      const text = `${await blob.text()}@${fit.mode}${fit.width}x${fit.height}`;
      calls.fit.push(text);
      return new Blob([text]);
    },
    asItself: async (blob) => !redrawn.includes(await blob.text()),
    flatten: () => {
      calls.flatten += 1;
      return Promise.resolve(new Blob(["flat"]));
    },
    exportMask: (objects, strokes) => {
      calls.exportMask += 1;
      return Promise.resolve(
        objects.length + strokes.length > 0 ? new Blob([`mask${objects.length}`]) : null,
      );
    },
    resize: (blob) => Promise.resolve(blob),
    currentMap: (key) =>
      key === "k1" ? { cid: "cid-map", blob: new Blob(["map"]), width: 64, height: 64 } : null,
    touchMap: () => {},
    sizeOf: () => Promise.resolve(SIZE),
  };
  return { tools, calls };
}

function uploader(frames: Frame[], batchTools: BatchTools, make = makers()) {
  const batch = new uploads.UploadBatch("t", { tools: batchTools });
  const up = materialise.createUploader({ frames, size: SIZE }, batch, { tools: make.tools });
  return { batch, up, make };
}

describe("the uploader", () => {
  it("stages one item per source, however many fields name it, under its cid", async () => {
    const frames = [frame("f1", "reference", picture("a"))];
    const { up, batch } = uploader(frames, server().tools);
    const first = (await up.file("f1", "a")).ref;
    const again = (await up.file("f1", "a")).ref;
    expect(again).toBe(first);
    expect(up.ledger.refs[first]).toEqual({ kind: "file", frameId: "f1", pictureId: "a" });
    expect(up.ledger.cids.get("cid-a")).toBe(first);
    const outcomes = await batch.run();
    expect(outcomes.get(first)).toMatchObject({ ref: `upload:${hashOf("a")}` });
  });

  it("flattens a composite once; a repeat claims it and flattens only when the server lost it", async () => {
    const frames = [frame("f1", "initial", layer("base"))];
    const store = server();
    const make = makers();
    const one = uploader(frames, store.tools, make);
    await one.up.composite("f1", SIZE);
    await one.batch.run();
    expect(make.calls.flatten).toBe(1);

    const two = uploader(frames, store.tools, make);
    const sent = await two.up.composite("f1", SIZE);
    expect(sent.size).toEqual(SIZE);
    await two.batch.run();
    expect(make.calls.flatten).toBe(1);
    expect(store.sent).toEqual(["input.png"]);

    store.forget("flat");
    const three = uploader(frames, store.tools, make);
    await three.up.composite("f1", SIZE);
    await three.batch.run();
    expect(make.calls.flatten).toBe(2);
    expect(store.sent).toEqual(["input.png", "input.png"]);
  });

  it("stages a fitted file under what made it, as a PNG, apart from the record's original", async () => {
    const frames = [
      frame("f1", "reference", picture("a", { name: "a.jpg", width: 6000, height: 4000 })),
    ];
    const store = server();
    const make = makers();
    const { up, batch } = uploader(frames, store.tools, make);
    const fit = { width: 1248, height: 832, mode: "stretch" as const };
    const sent = await up.file("f1", "a", fit);
    expect(sent.size).toEqual({ width: 1248, height: 832 });
    expect(up.ledger.refs[sent.ref]).toEqual({ kind: "file", frameId: "f1", pictureId: "a", fit });
    up.stageRecord(frames);
    const original = up.ledger.cids.get("cid-a");
    expect(original).toBeDefined();
    expect(original).not.toBe(sent.ref);
    // made only when the batch runs and the server lacks it
    expect(make.calls.fit).toEqual([]);
    const outcomes = await batch.run();
    expect(make.calls.fit).toEqual(["a@stretch1248x832"]);
    expect([...store.sent].sort()).toEqual(["a.jpg", "a.png"]);
    expect(outcomes.get(sent.ref)).toMatchObject({ ref: `upload:${hashOf("a@stretch1248x832")}` });
    expect(outcomes.get(original ?? "")).toMatchObject({ ref: `upload:${hashOf("a")}` });
  });

  it("claims a fitted copy by its remembered row after a reload instead of redrawing it", async () => {
    const frames = [frame("f1", "reference", picture("a", { width: 6000, height: 4000 }))];
    const store = server();
    const rows = new Map<string, { hash: string; size: number }>();
    const tools: BatchTools = {
      ...store.tools,
      readHashes: (keys) =>
        Promise.resolve(new Map(keys.flatMap((k) => (rows.has(k) ? [[k, rows.get(k)!]] : [])))),
      rememberHashes: (found) => {
        for (const [k, v] of found) rows.set(k, v);
        return Promise.resolve();
      },
    };
    const make = makers();
    const fit = { width: 1248, height: 832, mode: "stretch" as const };
    const one = uploader(frames, tools, make);
    await one.up.file("f1", "a", fit);
    await one.batch.run();
    expect([...rows.keys()]).toEqual(["cid-a/stretch|1248x832|png"]);

    vi.resetModules();
    materialise = await import("./materialise");
    uploads = await import("./uploads");
    const two = uploader(frames, tools, make);
    await two.up.file("f1", "a", fit);
    await two.batch.run();
    expect(make.calls.fit).toHaveLength(1);
    expect(store.sent).toHaveLength(1);
  });

  it("redraws at its own size a file the server would read otherwise than this browser shows it", async () => {
    const frames = [frame("f1", "reference", picture("a"))];
    const make = makers(["a"]);
    const { up, batch } = uploader(frames, server().tools, make);
    const sent = await up.file("f1", "a");
    expect(sent.size).toEqual(SIZE);
    await batch.run();
    expect(make.calls.fit).toEqual(["a@stretch64x64"]);
  });

  it("never stages an encoding that answers its input as the original", async () => {
    const frames = [frame("f1", "reference", picture("a"))];
    const make = makers();
    make.tools.optimise = (blob) => Promise.resolve({ blob, name: "a.png", size: SIZE });
    const { up } = uploader(frames, server().tools, make);
    const encoded = await up.upload({
      kind: "file",
      frameId: "f1",
      pictureId: "a",
      encode: { provider: "nanogpt", model: "m" },
    });
    up.stageRecord(frames);
    expect(encoded?.ref).toBeDefined();
    expect(up.ledger.cids.get("cid-a")).not.toBe(encoded?.ref);
  });

  it("crops and resizes a composite after drawing it for a cover fit", async () => {
    const frames = [frame("f1", "initial", layer("base"))];
    const make = makers();
    const { up, batch } = uploader(frames, server().tools, make);
    const plain = await up.composite("f1", SIZE);
    const covered = await up.composite("f1", SIZE, null, { width: 32, height: 64, mode: "cover" });
    expect(covered.size).toEqual({ width: 32, height: 64 });
    expect(covered.ref).not.toBe(plain.ref);
    await batch.run();
    expect(make.calls.fit).toEqual(["flat@cover32x64"]);
  });

  it("stages nothing for a mask with nothing painted", async () => {
    const frames = [frame("f1", "initial", layer("base"))];
    const { up } = uploader(frames, server().tools);
    expect(await up.mask("f1", SIZE)).toBeNull();
  });

  it("stages every picture, mask object, region mask and sent map for the record, once each", async () => {
    const paint = {
      ...frame("f1", "initial", layer("base"), layer("hidden", { visible: false })),
      mask: { objects: [maskObject("m")], strokes: [] },
    };
    const adapter = frame("f2", "ipAdapter", picture("face"));
    adapter.ipAdapter = { ...adapter.ipAdapter, masks: [picture("region")] };
    const store = server();
    const { up, batch } = uploader([paint, adapter], store.tools);
    const sentMap = await up.map("k1");
    up.stageRecord([paint, adapter]);
    expect([...up.ledger.cids.keys()].sort()).toEqual(
      ["cid-base", "cid-hidden", "cid-m", "cid-face", "cid-region", "cid-map"].sort(),
    );
    // the map the request sends is the same item the record keeps
    expect(up.ledger.cids.get("cid-map")).toBe(sentMap.ref);
    expect(up.ledger.maps).toEqual({ k1: "cid-map" });
    const outcomes = await batch.run();
    for (const ref of up.ledger.cids.values()) {
      const outcome = outcomes.get(ref);
      expect(outcome && "ref" in outcome ? outcome.ref : null).toMatch(/^upload:/);
    }
  });
});
