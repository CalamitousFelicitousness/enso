import { beforeEach, describe, expect, it, vi } from "vitest";

let ApiError: typeof import("./client").ApiError;
let retryUnlessRefused: typeof import("./queryKeys").retryUnlessRefused;
let storeOffIn: typeof import("./queryKeys").storeOffIn;

beforeEach(async () => {
  vi.stubGlobal("window", { location: { origin: "http://localhost:5174" } });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  ({ ApiError } = await import("./client"));
  ({ retryUnlessRefused, storeOffIn } = await import("./queryKeys"));
});

const storeOff = () =>
  new ApiError(503, "Service Unavailable", {
    error: "HTTPException",
    code: 503,
    detail: { code: "media_store_off", message: "Media store off: the folder is not writable" },
  });

describe("storeOffIn", () => {
  it("says the store is off in the refusal's own words, which name it already", () => {
    expect(storeOffIn(storeOff())).toBe("Media store off: the folder is not writable");
  });

  it("says the store is off when the refusal's words are empty", () => {
    const bare = new ApiError(503, "Service Unavailable", {
      detail: { code: "media_store_off", message: "" },
    });
    expect(storeOffIn(bare)).toBe("The media store is off");
  });

  it("is nothing for any other failure", () => {
    expect(storeOffIn(new ApiError(404, "Not Found", { detail: { code: "gone" } }))).toBeNull();
    expect(storeOffIn(new TypeError("Failed to fetch"))).toBeNull();
  });
});

describe("retryUnlessRefused", () => {
  it("does not ask again after a 4xx", () => {
    expect(retryUnlessRefused(0, new ApiError(404, "Not Found", {}))).toBe(false);
  });

  it("does not ask again after a coded refusal, whatever its status", () => {
    expect(retryUnlessRefused(0, storeOff())).toBe(false);
  });

  it("asks twice more after a failure that is not a refusal", () => {
    const failure = new ApiError(503, "Service Unavailable", { detail: "busy" });
    expect([0, 1, 2].map((n) => retryUnlessRefused(n, failure))).toEqual([true, true, false]);
    expect(retryUnlessRefused(0, new TypeError("Failed to fetch"))).toBe(true);
  });
});
