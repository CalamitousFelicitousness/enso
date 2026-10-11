import { describe, expect, it } from "vitest";
import { commitKind, retirable, shortensRetention, type RecordFacts } from "./settings";

const HOUR = 60 * 60 * 1000;
const NOW = 1000 * HOUR;

const record = (id: string, hoursAgo: number, patch: Partial<RecordFacts> = {}): RecordFacts => ({
  job_id: id,
  created_at: NOW - hoursAgo * HOUR,
  routed: true,
  domain: "generate",
  ...patch,
});

describe("commitKind", () => {
  it("writes a raise at once and does nothing for the same value", () => {
    expect(commitKind("library_cap", 100, 120, { here: 0, server: 0 })).toBe("write");
    expect(commitKind("library_cap", 100, 100, { here: 5, server: 5 })).toBe("none");
  });

  it("asks before a reduction that lets something go, and writes one that lets nothing go", () => {
    expect(commitKind("trash_days", 7, 3, { here: 2, server: 0 })).toBe("confirm");
    expect(commitKind("library_cap", 100, 50, { here: 0, server: 4 })).toBe("confirm");
    expect(commitKind("trash_days", 7, 3, { here: 0, server: 0 })).toBe("write");
  });

  it("always asks before lowering the record cap: other browsers' records are not listed here", () => {
    expect(commitKind("record_cap", 200, 150, { here: 0, server: 0 })).toBe("confirm");
  });
});

describe("retirable", () => {
  it("counts the oldest past the cap", () => {
    const records = [record("a", 30), record("b", 20), record("c", 10), record("d", 1)];
    expect(retirable(records, 2, new Set(), NOW)).toBe(2);
    expect(retirable(records, 4, new Set(), NOW)).toBe(0);
  });

  it("skips a live job's record and an unrouted strip record under 168 hours, as the server does", () => {
    const records = [
      record("live", 300),
      record("waiting", 100, { routed: false }),
      record("old-waiting", 200, { routed: false }),
      record("upscale", 50, { routed: false, domain: "upscale" }),
      record("new", 1),
    ];
    // the excess is 3: live and waiting are skipped, the next oldest go in their place
    expect(retirable(records, 2, new Set(["live"]), NOW)).toBe(3);
    // a skip does not count toward the excess, and nothing past it is retired
    expect(retirable(records.slice(0, 3), 1, new Set(["live"]), NOW)).toBe(1);
  });
});

describe("shortensRetention", () => {
  it("asks only when the server keeps removed inputs for less time", () => {
    expect(shortensRetention(7, 30)).toBe(true);
    expect(shortensRetention(30, 7)).toBe(false);
    expect(shortensRetention(7, 7)).toBe(false);
  });
});
