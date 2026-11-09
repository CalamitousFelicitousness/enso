import { describe, expect, it } from "vitest";
import { META_KEYS } from "@/lib/inputs/metaKeys";
import { META, STORES } from "@/lib/inputs/storeLayout";
import { MANIFEST, RESET_ROWS, type ProfileEntry } from "./manifest";
import { DB, LOCAL, LOCAL_PREFIX } from "./names";

const of = <K extends ProfileEntry["kind"]>(kind: K) =>
  MANIFEST.filter((e): e is Extract<ProfileEntry, { kind: K }> => e.kind === kind);

describe("the profile manifest", () => {
  it("gives every localStorage key but the reset's own record exactly one entry", () => {
    const keys = of("local").map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    const owned = Object.values(LOCAL).filter((key) => key !== LOCAL.reset);
    expect([...keys].sort()).toEqual(owned.sort());
  });

  it("gives every row at least one entry", () => {
    for (const row of RESET_ROWS) expect(MANIFEST.some((e) => e.group === row)).toBe(true);
  });

  it("names every localStorage key under the prefix", () => {
    for (const key of Object.values(LOCAL)) expect(key.startsWith(LOCAL_PREFIX)).toBe(true);
  });

  it("gives every store of enso-inputs but meta exactly one entry", () => {
    const stores = of("store").map((e) => e.store);
    expect(new Set(stores).size).toBe(stores.length);
    expect([...stores].sort()).toEqual(STORES.filter((s) => s !== META).sort());
  });

  it("gives every meta key exactly one entry", () => {
    const keys = of("meta").map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...META_KEYS].sort());
  });

  it("accounts for every database once, whole or by its records", () => {
    const whole = of("database").map((e) => e.db);
    const byRecord = new Set(of("record").map((e) => e.db));
    expect(new Set(whole).size).toBe(whole.length);
    for (const db of whole) expect(byRecord.has(db)).toBe(false);
    const covered = new Set([...whole, ...byRecord, DB.inputs]);
    expect([...covered].sort()).toEqual(Object.values(DB).sort());
  });

  it("gives every record key exactly one entry", () => {
    const records = of("record").map((e) => `${e.db}/${e.store}/${e.key}`);
    expect(new Set(records).size).toBe(records.length);
  });

  it("names the fields a record leaves to another group", () => {
    for (const entry of of("local")) {
      if (!entry.fields) continue;
      expect(entry.fields.names.length).toBeGreaterThan(0);
      expect(entry.fields.group).not.toBe(entry.group);
    }
  });
});
