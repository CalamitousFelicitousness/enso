import { describe, expect, it } from "vitest";
import { awaitsRouting, planJobTrim, SERVER_JOB_RETENTION_MS } from "./retention";

const records = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `j${i}`, createdAt: i }));

describe("planJobTrim", () => {
  it("retires the oldest records past the cap and never one the keep set names", () => {
    const all = records(10);
    expect(planJobTrim(all, 6, new Set())).toEqual(["j0", "j1", "j2", "j3"]);
    expect(planJobTrim(all, 6, new Set(["j1", "j9"]))).toEqual(["j0", "j2", "j3"]);
    // order of the listing does not matter
    expect(planJobTrim([...all].reverse(), 6, new Set())).toEqual(["j0", "j1", "j2", "j3"]);
  });

  it("keeps every record under the cap", () => {
    expect(planJobTrim(records(6), 6, new Set())).toEqual([]);
    expect(planJobTrim([], 0, new Set())).toEqual([]);
  });
});

describe("awaitsRouting", () => {
  const now = 10 * SERVER_JOB_RETENTION_MS;

  it("holds an unrouted generation or video the server may still have", () => {
    expect(awaitsRouting({ domain: "generate", routed: false, createdAt: now - 1000 }, now)).toBe(
      true,
    );
    expect(awaitsRouting({ domain: "ltx", routed: false, createdAt: now - 1000 }, now)).toBe(true);
  });

  it("lets go of a routed record, an old one and one whose result has no strip", () => {
    expect(awaitsRouting({ domain: "generate", routed: true, createdAt: now - 1000 }, now)).toBe(
      false,
    );
    expect(
      awaitsRouting(
        { domain: "generate", routed: false, createdAt: now - SERVER_JOB_RETENTION_MS },
        now,
      ),
    ).toBe(false);
    expect(awaitsRouting({ domain: "preprocess", routed: false, createdAt: now }, now)).toBe(false);
  });
});
