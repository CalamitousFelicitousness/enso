import { describe, expect, it } from "vitest";
import { META_KEY } from "@/lib/inputs/metaKeys";
import { DOCUMENTS, JOBS, LIBRARY, MAPS, SNAPSHOTS, TRASH } from "@/lib/inputs/storeLayout";
import { CONTENT_ROWS, MANIFEST, type ResetRow } from "./manifest";
import { DB, LOCAL, RECORD } from "./names";
import { chosenGroups, emptiesDocument, planReset, rewriteRecord } from "./plan";

const plan = (rows: ResetRow[], held = false) => planReset(MANIFEST, rows, held);

describe("planReset", () => {
  it("clears the inputs store by store for Inputs and results alone", () => {
    const p = plan(["work"], true);
    expect(p.databases).not.toContain(DB.inputs);
    expect(p.inputs?.clear.sort()).toEqual([DOCUMENTS, MAPS, SNAPSHOTS, TRASH].sort());
    expect(p.inputs?.meta).not.toContain(META_KEY.client);
    expect(p.inputs?.clear).not.toContain(LIBRARY);
    expect(p.inputs?.clear).not.toContain(JOBS);
    expect(emptiesDocument(p)).toBe(true);
    expect(p.databases).toEqual(
      expect.arrayContaining([DB.control, DB.videoCanvas, DB.history, DB.videoHistory]),
    );
    expect(p.remove).toEqual([LOCAL.videoHashes]);
    expect(p.full).toBe(false);
  });

  it("keeps the strip limit when only the settings go, and drops it with the results", () => {
    expect(plan(["parameters"]).rewrite).toEqual(
      expect.arrayContaining([
        { key: LOCAL.generation, keep: ["historyLimit"] },
        { key: LOCAL.video, keep: ["historyLimit"] },
      ]),
    );
    expect(plan(["work"]).rewrite).toEqual(
      expect.arrayContaining([{ key: LOCAL.generation, drop: ["historyLimit"] }]),
    );
    const both = plan(["work", "parameters"]);
    expect(both.remove).toContain(LOCAL.generation);
    expect(both.rewrite).toEqual([]);
  });

  it("takes the Color LUT bytes with the settings that name them", () => {
    expect(plan(["parameters"]).databases).toContain(DB.colorLut);
    expect(plan(["work"]).databases).not.toContain(DB.colorLut);
  });

  it("deletes the canvas database whole only with both of its rows", () => {
    expect(plan(["work"]).records).toEqual([
      { db: DB.canvas, store: "state", keys: [RECORD.canvasV4, RECORD.canvasV3] },
    ]);
    expect(plan(["interface"]).records).toEqual([
      { db: DB.canvas, store: "state", keys: [RECORD.canvas] },
    ]);
    const both = plan(["work", "interface"]);
    expect(both.databases).toContain(DB.canvas);
    expect(both.records).toEqual([]);
  });

  it("goes with caches and the marker only for every content row", () => {
    const full = plan([...CONTENT_ROWS]);
    expect(full.full).toBe(true);
    expect(full.databases).toEqual(expect.arrayContaining([DB.thumbs, DB.dicts]));
    expect(full.remove).toEqual(expect.arrayContaining([LOCAL.profile, LOCAL.modelDownloads]));
    expect(full.inputs?.meta).toContain(META_KEY.trashDays);
    const partial = plan(["work", "parameters", "saved"]);
    expect(partial.full).toBe(false);
    expect(partial.databases).not.toContain(DB.thumbs);
    expect(partial.remove).not.toContain(LOCAL.profile);
  });

  it("leaves the trash retention to the caches, not the settings", () => {
    expect(plan(["parameters"], true).inputs).toBeNull();
  });

  it("touches nothing of the inputs for the connection alone but its two keys", () => {
    const p = plan(["connection"], true);
    expect(p.remove.sort()).toEqual([LOCAL.client, LOCAL.connections, LOCAL.sessionMode].sort());
    expect(p.inputs).toEqual({ clear: [], meta: [META_KEY.client, META_KEY.migrateTarget] });
    expect(p.databases).toEqual([]);
  });

  it("deletes what older builds kept only with its own row", () => {
    expect(plan([...CONTENT_ROWS, "connection"], true).inputs?.clear).not.toContain(LIBRARY);
    const legacy = plan(["legacy"], true);
    expect(legacy.inputs?.clear.sort()).toEqual([JOBS, LIBRARY].sort());
    expect(legacy.inputs?.meta).toEqual([META_KEY.migrateSilenced]);
  });

  it("deletes the inputs database whole only when nothing of it stays", () => {
    expect(plan([...CONTENT_ROWS, "connection"], false).databases).toContain(DB.inputs);
    expect(plan([...CONTENT_ROWS, "connection"], true).databases).not.toContain(DB.inputs);
    expect(plan([...CONTENT_ROWS, "connection", "legacy"], true).databases).toContain(DB.inputs);
    expect(plan(["work", "connection"], false).databases).not.toContain(DB.inputs);
  });

  it("never lets a single row reach what another row owns", () => {
    const rows: ResetRow[] = ["work", "parameters", "saved", "interface", "connection", "legacy"];
    const plans = rows.map((row) => plan([row], true));
    const removed = plans.flatMap((p) => p.remove);
    expect(new Set(removed).size).toBe(removed.length);
    const rewritten = plans.flatMap((p) => p.rewrite);
    for (const key of removed) expect(rewritten.map((r) => r.key)).not.toContain(key);
    // a record two rows share is split by field: what one keeps, the other drops
    for (const kept of rewritten.filter((r) => "keep" in r)) {
      const dropped = rewritten.find((r) => r.key === kept.key && "drop" in r);
      expect(dropped && "drop" in dropped && dropped.drop).toEqual(kept.keep);
    }
  });
});

describe("chosenGroups", () => {
  it("adds the caches for every content row and the legacy stores when none are held", () => {
    expect(chosenGroups(CONTENT_ROWS, true).has("caches")).toBe(true);
    expect(chosenGroups(["work"], true).has("caches")).toBe(false);
    expect(chosenGroups(["work"], false).has("legacy")).toBe(true);
    expect(chosenGroups(["work"], true).has("legacy")).toBe(false);
  });
});

describe("rewriteRecord", () => {
  const raw = JSON.stringify({ state: { prompt: "a", historyLimit: 40 }, version: 5 });

  it("keeps only the named fields, with the version", () => {
    expect(rewriteRecord(raw, { key: LOCAL.generation, keep: ["historyLimit"] })).toBe(
      '{"state":{"historyLimit":40},"version":5}',
    );
  });

  it("drops the named fields", () => {
    expect(rewriteRecord(raw, { key: LOCAL.generation, drop: ["historyLimit"] })).toBe(
      '{"state":{"prompt":"a"},"version":5}',
    );
  });

  it("answers null when nothing is left or the record cannot be read", () => {
    expect(rewriteRecord(raw, { key: LOCAL.generation, keep: ["other"] })).toBeNull();
    expect(rewriteRecord("{", { key: LOCAL.generation, keep: ["x"] })).toBeNull();
    expect(rewriteRecord('{"state":1}', { key: LOCAL.generation, keep: ["x"] })).toBeNull();
  });
});
