import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketManager } from "./websocket";

/** A socket that never reaches the server: every attempt closes as abnormal (1006). */
class UnreachableSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static attempts = 0;
  readyState = UnreachableSocket.CONNECTING;
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor() {
    UnreachableSocket.attempts++;
    setTimeout(() => {
      this.readyState = 3;
      this.onclose?.({ code: 1006 });
    }, 0);
  }

  close() {}
}

describe("WebSocketManager reconnects", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    UnreachableSocket.attempts = 0;
    vi.stubGlobal("WebSocket", UnreachableSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("gives up after ten attempts by default", async () => {
    const maxRetries = vi.fn();
    const manager = new WebSocketManager("ws://server/socket");
    manager.on("max_retries", maxRetries);
    manager.connect();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(UnreachableSocket.attempts).toBe(11);
    expect(maxRetries).toHaveBeenCalledOnce();
  });

  it("keeps trying, every 30 s at most, when the limit is lifted", async () => {
    const manager = new WebSocketManager("ws://server/socket", undefined, {
      maxReconnectAttempts: Infinity,
    });
    manager.connect();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const afterTenMinutes = UnreachableSocket.attempts;
    expect(afterTenMinutes).toBeGreaterThan(20);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(UnreachableSocket.attempts - afterTenMinutes).toBe(10);
  });
});
