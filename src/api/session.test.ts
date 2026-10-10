import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PAGE = "http://localhost:5174";

/** The session module with a fresh store, on a page at PAGE. */
async function load() {
  vi.resetModules();
  vi.stubGlobal("window", { location: { origin: PAGE } });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
  });
  const client = await import("./client");
  const session = await import("./session");
  return { api: client.api, ApiError: client.ApiError, ...session };
}

describe("mediaUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("puts server paths on the base and adds nothing on the page's own origin", async () => {
    const { mediaUrl, useSessionStore } = await load();
    useSessionStore.setState({ mode: "cookie", token: "abc" });
    expect(mediaUrl("/sdapi/v2/outputs/1")).toBe(`${PAGE}/sdapi/v2/outputs/1`);
  });

  it("carries the token on another origin, after any query", async () => {
    const { api, mediaUrl, useSessionStore } = await load();
    api.setBaseUrl("http://127.0.0.1:7855");
    useSessionStore.setState({ mode: "token", token: "a b" });
    expect(mediaUrl("/sdapi/v2/outputs/1")).toBe(
      "http://127.0.0.1:7855/sdapi/v2/outputs/1?t=a%20b",
    );
    expect(mediaUrl("/sdapi/v2/browser/file?path=x")).toBe(
      "http://127.0.0.1:7855/sdapi/v2/browser/file?path=x&t=a%20b",
    );
  });

  it("leaves data:, blob: and absolute URLs as they are", async () => {
    const { mediaUrl, useSessionStore } = await load();
    useSessionStore.setState({ mode: "token", token: "abc" });
    for (const url of [
      "data:image/png;base64,AAAA",
      "blob:http://x/1",
      "https://civitai.com/a.png",
    ])
      expect(mediaUrl(url)).toBe(url);
  });

  it("carries no token to paths outside the API", async () => {
    const { api, mediaUrl, useSessionStore } = await load();
    api.setBaseUrl("http://127.0.0.1:7855");
    useSessionStore.setState({ mode: "token", token: "abc" });
    expect(mediaUrl("/enso/version.json")).toBe("http://127.0.0.1:7855/enso/version.json");
  });
});

describe("the session request", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("settles on cookies for the page's own origin and advances the epoch", async () => {
    const { api, startSession, useSessionStore } = await load();
    vi.spyOn(api, "post").mockResolvedValue({
      required: true,
      token: "t1",
      expires_at: Date.now() + 86_400_000,
      user: "alice",
    });
    const before = useSessionStore.getState().epoch;
    await startSession();
    const { mode, token, epoch } = useSessionStore.getState();
    expect([mode, token]).toEqual(["cookie", "t1"]);
    expect(epoch).toBeGreaterThan(before);
  });

  it("settles open when the server asks for no credentials", async () => {
    const { api, startSession, useSessionStore } = await load();
    vi.spyOn(api, "post").mockResolvedValue({ required: false });
    await startSession();
    expect(useSessionStore.getState().mode).toBe("open");
  });

  it("takes a server without sessions for legacy", async () => {
    const { api, ApiError, startSession, useSessionStore } = await load();
    vi.spyOn(api, "post").mockRejectedValue(new ApiError(404, "Not Found", {}));
    await startSession();
    expect(useSessionStore.getState().mode).toBe("legacy");
  });

  it("leaves open for unavailable when the server starts asking for credentials", async () => {
    const { api, ApiError, ensureSession, startSession, useSessionStore } = await load();
    const post = vi.spyOn(api, "post").mockResolvedValue({ required: false });
    await startSession();
    post.mockRejectedValue(new ApiError(401, "Unauthorized", {}));
    await ensureSession();
    expect(useSessionStore.getState().mode).toBe("unavailable");
  });

  it("settles unavailable when the server cannot be reached", async () => {
    const { api, startSession, useSessionStore } = await load();
    vi.spyOn(api, "post").mockRejectedValue(new TypeError("Failed to fetch"));
    await startSession();
    expect(useSessionStore.getState().mode).toBe("unavailable");
  });
});

describe("renewAfterFailure", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function cookieSession() {
    const loaded = await load();
    let n = 0;
    const post = vi.spyOn(loaded.api, "post").mockImplementation(() =>
      Promise.resolve({
        required: true,
        token: `t${++n}`,
        expires_at: Date.now() + 86_400_000,
        user: null,
      }),
    );
    await loaded.startSession();
    return { ...loaded, post };
  }

  it("answers yes at once when a renewal came after the load started", async () => {
    const { post, renewAfterFailure, useSessionStore } = await cookieSession();
    const loadEpoch = useSessionStore.getState().epoch - 1;
    expect(await renewAfterFailure(loadEpoch)).toBe(true);
    expect(post).toHaveBeenCalledOnce();
  });

  it("renews a stale session, then spaces further attempts 10 s apart", async () => {
    const { post, renewAfterFailure, useSessionStore } = await cookieSession();
    await vi.advanceTimersByTimeAsync(11_000);
    const loadEpoch = useSessionStore.getState().epoch;
    expect(await renewAfterFailure(loadEpoch)).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
    const later = useSessionStore.getState().epoch;
    expect(await renewAfterFailure(later)).toBe(false);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("does not renew for a server without sessions", async () => {
    const { api, ApiError, renewAfterFailure, startSession, useSessionStore } = await load();
    const post = vi.spyOn(api, "post").mockRejectedValue(new ApiError(404, "Not Found", {}));
    await startSession();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await renewAfterFailure(useSessionStore.getState().epoch)).toBe(false);
    expect(post).toHaveBeenCalledOnce();
  });
});

describe("endSession", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function settled(base: string | null, required: boolean) {
    const loaded = await load();
    if (base) loaded.api.setBaseUrl(base);
    vi.spyOn(loaded.api, "post").mockResolvedValue({
      required,
      token: required ? "t1" : null,
      expires_at: required ? Date.now() + 86_400_000 : null,
      user: null,
    });
    await loaded.startSession();
    const end = vi.spyOn(loaded.api, "delete").mockResolvedValue("");
    return { ...loaded, end };
  }

  it("ends a session the page's cookie carries", async () => {
    const { end, endSession } = await settled(null, true);
    await endSession();
    expect(end).toHaveBeenCalledWith("/sdapi/v2/session", undefined);
  });

  it("names the token of a session on another origin", async () => {
    const { end, endSession } = await settled("http://127.0.0.1:7855", true);
    await endSession();
    expect(end).toHaveBeenCalledWith("/sdapi/v2/session", { t: "t1" });
  });

  it("has nothing to end on a server that asks for no credentials", async () => {
    const { end, endSession } = await settled(null, false);
    await endSession();
    expect(end).not.toHaveBeenCalled();
  });

  it("takes a refusal for a session already ended", async () => {
    const { ApiError, end, endSession } = await settled(null, true);
    end.mockRejectedValue(new ApiError(404, "Not Found", {}));
    await expect(endSession()).resolves.toBeUndefined();
  });
});
