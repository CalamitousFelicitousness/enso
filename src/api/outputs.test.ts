import { beforeEach, describe, expect, it, vi } from "vitest";

let outputIdOf: typeof import("./outputs").outputIdOf;

beforeEach(async () => {
  vi.stubGlobal("window", { location: { origin: "http://localhost:5174" } });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  ({ outputIdOf } = await import("./outputs"));
});

describe("outputIdOf", () => {
  it("reads the id of an output's durable URL, on the page's base or another", () => {
    expect(outputIdOf("/sdapi/v2/outputs/0123456789abcdef")).toBe("0123456789abcdef");
    expect(outputIdOf("http://127.0.0.1:7855/sdapi/v2/outputs/0123456789abcdef?t=x")).toBe(
      "0123456789abcdef",
    );
  });

  it("is null for a job-scoped URL, raw base64 or another id", () => {
    expect(outputIdOf("/sdapi/v2/jobs/0123456789abcdef/images/0")).toBeNull();
    expect(outputIdOf("iVBORw0KGgoAAAANSUhEUg")).toBeNull();
    expect(outputIdOf("/sdapi/v2/outputs/../../etc")).toBeNull();
    expect(outputIdOf("/sdapi/v2/outputs/0123")).toBeNull();
  });
});
