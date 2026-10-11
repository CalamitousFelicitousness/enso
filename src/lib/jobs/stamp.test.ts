import { describe, expect, it } from "vitest";
import { jobIdOf, stampIn, stripStamp } from "./stamp";

const PARAMS = "a cat\nNegative prompt: blur\nSteps: 20, Seed: 1";

describe("the job stamp", () => {
  it("is read from the end of a text", () => {
    expect(stampIn(`${PARAMS}, Enso job: enso-0123abcd`)).toBe("0123abcd");
    expect(stampIn(`${PARAMS}, Enso job: enso-0123abcd\n`)).toBe("0123abcd");
    expect(stampIn(PARAMS)).toBeNull();
    expect(stampIn(null)).toBeNull();
  });

  it("is left alone when pasted inside a prompt", () => {
    const pasted = "a cat, Enso job: enso-0123abcd\nSteps: 20, Seed: 1";
    expect(stampIn(pasted)).toBeNull();
    expect(stripStamp(pasted)).toBe(pasted);
  });

  it("leaves the text it ends", () => {
    expect(stripStamp(`${PARAMS}, Enso job: enso-0123abcd`)).toBe(PARAMS);
  });

  it("is read from the value the server's parse gives", () => {
    expect(jobIdOf("enso-0123abcd")).toBe("0123abcd");
    expect(jobIdOf("0123abcd")).toBeNull();
    expect(jobIdOf("enso-")).toBeNull();
    expect(jobIdOf(12)).toBeNull();
  });
});
