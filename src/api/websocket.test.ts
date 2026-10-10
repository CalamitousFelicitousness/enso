import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketManager } from "./websocket";

/** A socket the server answers with the next close code in `codes`, or 1006 (unreachable) when none is left. */
class ScriptedSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static attempts = 0;
  static codes: number[] = [];
  readyState = ScriptedSocket.CONNECTING;
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor() {
    ScriptedSocket.attempts++;
    const code = ScriptedSocket.codes.shift() ?? 1006;
    setTimeout(() => {
      this.readyState = 3;
      this.onclose?.({ code });
    }, 0);
  }

  close() {}
}

const at = (url: string) => () => Promise.resolve(url);

describe("WebSocketManager reconnects", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ScriptedSocket.attempts = 0;
    ScriptedSocket.codes = [];
    vi.stubGlobal("WebSocket", ScriptedSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("gives up after ten attempts by default", async () => {
    const maxRetries = vi.fn();
    const manager = new WebSocketManager(at("ws://server/socket"));
    manager.on("max_retries", maxRetries);
    manager.connect();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(ScriptedSocket.attempts).toBe(11);
    expect(maxRetries).toHaveBeenCalledOnce();
  });

  it("keeps trying, every 30 s at most, when the limit is lifted", async () => {
    const manager = new WebSocketManager(at("ws://server/socket"), {
      maxReconnectAttempts: Infinity,
    });
    manager.connect();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const afterTenMinutes = ScriptedSocket.attempts;
    expect(afterTenMinutes).toBeGreaterThan(20);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(ScriptedSocket.attempts - afterTenMinutes).toBe(10);
  });

  it("renews once when refused, then reconnects at once", async () => {
    ScriptedSocket.codes = [1008, 4004];
    const onRefused = vi.fn(() => Promise.resolve(true));
    const manager = new WebSocketManager(at("ws://server/socket"), { onRefused });
    manager.connect();
    await vi.advanceTimersByTimeAsync(10);
    expect(onRefused).toHaveBeenCalledOnce();
    expect(ScriptedSocket.attempts).toBe(2);
  });

  it("stops when refused again after a renewal", async () => {
    ScriptedSocket.codes = [1008, 1008, 1008];
    const onRefused = vi.fn(() => Promise.resolve(true));
    const manager = new WebSocketManager(at("ws://server/socket"), { onRefused });
    manager.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onRefused).toHaveBeenCalledOnce();
    expect(ScriptedSocket.attempts).toBe(2);
  });

  it("renews again for a refusal that follows a lost connection", async () => {
    ScriptedSocket.codes = [1008, 1006, 1008, 4004];
    const onRefused = vi.fn(() => Promise.resolve(true));
    const manager = new WebSocketManager(at("ws://server/socket"), { onRefused });
    manager.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onRefused).toHaveBeenCalledTimes(2);
    expect(ScriptedSocket.attempts).toBe(4);
  });

  it("stops when refused and the renewal cannot help", async () => {
    ScriptedSocket.codes = [1008];
    const manager = new WebSocketManager(at("ws://server/socket"), {
      onRefused: () => Promise.resolve(false),
    });
    manager.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ScriptedSocket.attempts).toBe(1);
  });

  it("opens nothing when disconnected while its URL resolves", async () => {
    let resolve: (url: string) => void = () => {};
    const manager = new WebSocketManager(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    manager.connect();
    manager.disconnect();
    resolve("ws://server/socket");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ScriptedSocket.attempts).toBe(0);
  });
});
