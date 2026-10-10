import { describe, expect, it } from "vitest";
import { ReplayError } from "@/lib/jobs/replay";
import {
  assertNoneStaged,
  isStaged,
  missesOf,
  stagedIn,
  substituteStaged,
  type Outcome,
} from "./stage";

const A = "staged:00000000-0000-4000-8000-00000000000a";
const B = "staged:00000000-0000-4000-8000-00000000000b";
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);

describe("placeholders", () => {
  it("are found at any depth, once each, and never in a prompt", () => {
    const request = {
      prompt: "staged: a cat on a mat",
      inputs: [A, A],
      control: [{ override: B }],
    };
    expect(stagedIn(request)).toEqual([A, B]);
    expect(isStaged("staged:12")).toBe(false);
  });

  it("are replaced by their refs in a copy, the request left as it was", () => {
    const request = { inputs: [A], control: [{ override: B }], prompt: "x" };
    const outcomes = new Map<string, Outcome>([
      [A, { ref: `upload:${H1}`, hash: H1, size: 1 }],
      [B, { ref: `upload:${H2}`, hash: H2, size: 1 }],
    ]);
    expect(substituteStaged(request, outcomes)).toEqual({
      inputs: [`upload:${H1}`],
      control: [{ override: `upload:${H2}` }],
      prompt: "x",
    });
    expect(request.inputs).toEqual([A]);
  });

  it("whose bytes are gone stop the request with what was missing", () => {
    const outcomes = new Map<string, Outcome>([
      [A, { gone: true, source: { kind: "map", key: "k", drawnAt: null, encode: null } }],
    ]);
    expect(() => substituteStaged({ inputs: [A] }, outcomes)).toThrow(ReplayError);
    expect(() => substituteStaged({ inputs: [A] }, outcomes)).toThrow(
      "A map this job sent is no longer stored",
    );
  });

  it("left in a request are named before it can be sent", () => {
    expect(() => assertNoneStaged({ prompt: "staged: x", inputs: [A] })).toThrow(A);
    expect(() => assertNoneStaged({ inputs: [`upload:${H1}`] })).not.toThrow();
  });
});

describe("missesOf", () => {
  it("reads a job's ref and a record's bare hash as the hash, once", () => {
    const issues = [
      { type: "upload_missing", input: `upload:${H1}`, loc: ["body", "job", "inputs", 0] },
      { type: "upload_missing", input: H1, loc: ["body", "job", "inputs", 0] },
      { type: "upload_missing", input: H2, loc: ["body", "record", "hashes", "cid"] },
      { type: "unhashed_cid", input: "cid", loc: ["body", "record"] },
      { type: "upload_missing", input: "upload:0123456789abcdef", loc: ["body", "job"] },
    ];
    expect(missesOf(issues)).toEqual([H1, H2]);
  });
});
