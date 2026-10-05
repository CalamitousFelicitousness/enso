import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageValue } from "zustand/middleware";
import { createGatedStorage, type KeyValueBackend } from "./idbStorage";

interface Doc {
  n: number;
}

const record = (n: number): StorageValue<Doc> => ({ state: { n }, version: 1 });

function memoryBackend(initial: Record<string, unknown> = {}) {
  const records = new Map<string, unknown>(Object.entries(initial));
  const fail = { get: false, set: false };
  let writes = 0;
  const backend: KeyValueBackend = {
    get: (key) =>
      fail.get
        ? Promise.reject(new Error("read failed"))
        : Promise.resolve(records.get(key) ?? null),
    set: (key, value) => {
      if (fail.set) return Promise.reject(new Error("write failed"));
      writes += 1;
      records.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      records.delete(key);
      return Promise.resolve();
    },
  };
  return { backend, records, fail, writes: () => writes };
}

const settle = () => vi.advanceTimersByTimeAsync(2000);

describe("createGatedStorage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("drops writes that arrive before the record has been read", async () => {
    const { backend, records } = memoryBackend({ doc: record(1) });
    const storage = createGatedStorage<Doc>(backend, "test");
    void storage.setItem("doc", record(0));
    await settle();
    expect(records.get("doc")).toEqual(record(1));
  });

  it("writes the last value of a burst once", async () => {
    const { backend, records, writes } = memoryBackend();
    const storage = createGatedStorage<Doc>(backend, "test");
    await storage.getItem("doc");
    void storage.setItem("doc", record(1));
    void storage.setItem("doc", record(2));
    void storage.setItem("doc", record(3));
    await settle();
    expect(records.get("doc")).toEqual(record(3));
    expect(writes()).toBe(1);
  });

  it("keeps the stored record when the read fails", async () => {
    const { backend, records, fail } = memoryBackend({ doc: record(1) });
    const storage = createGatedStorage<Doc>(backend, "test");
    fail.get = true;
    await expect(storage.getItem("doc")).rejects.toThrow("read failed");
    void storage.setItem("doc", record(0));
    await settle();
    expect(records.get("doc")).toEqual(record(1));
  });

  it("writes again after a retried read succeeds", async () => {
    const { backend, records, fail } = memoryBackend({ doc: record(1) });
    const storage = createGatedStorage<Doc>(backend, "test");
    fail.get = true;
    await expect(storage.getItem("doc")).rejects.toThrow();
    fail.get = false;
    await expect(storage.getItem("doc")).resolves.toEqual(record(1));
    void storage.setItem("doc", record(2));
    await settle();
    expect(records.get("doc")).toEqual(record(2));
  });

  it("drops a queued write when a later read of the record fails", async () => {
    const { backend, records, fail } = memoryBackend({ doc: record(1) });
    const storage = createGatedStorage<Doc>(backend, "test");
    await storage.getItem("doc");
    void storage.setItem("doc", record(2));
    fail.get = true;
    await expect(storage.getItem("doc")).rejects.toThrow();
    void storage.setItem("doc", record(3));
    await settle();
    expect(records.get("doc")).toEqual(record(1));
  });

  it("replaces an unread record only after startEmpty", async () => {
    const { backend, records, fail } = memoryBackend({ doc: record(1) });
    const storage = createGatedStorage<Doc>(backend, "test");
    fail.get = true;
    await expect(storage.getItem("doc")).rejects.toThrow();
    storage.startEmpty();
    void storage.setItem("doc", record(0));
    await settle();
    expect(records.get("doc")).toEqual(record(0));
  });

  it("treats an unreadable record as a failed read", async () => {
    const { backend, records } = memoryBackend({ doc: "{not json" });
    const storage = createGatedStorage<Doc>(backend, "test");
    await expect(storage.getItem("doc")).rejects.toThrow("unreadable record");
    void storage.setItem("doc", record(0));
    await settle();
    expect(records.get("doc")).toBe("{not json");
  });

  it("reads a JSON record written by an earlier build", async () => {
    const { backend } = memoryBackend({ doc: JSON.stringify(record(4)) });
    const storage = createGatedStorage<Doc>(backend, "test");
    await expect(storage.getItem("doc")).resolves.toEqual(record(4));
  });

  it("falls back to the legacy key and leaves it in place", async () => {
    const { backend, records } = memoryBackend({ old: record(7) });
    const storage = createGatedStorage<Doc>(backend, "test", { legacyKey: "old" });
    await expect(storage.getItem("doc")).resolves.toEqual(record(7));
    void storage.setItem("doc", record(8));
    await settle();
    expect(records.get("old")).toEqual(record(7));
    expect(records.get("doc")).toEqual(record(8));
  });

  it("seeds an empty store and writes the seed at once", async () => {
    const { backend, records } = memoryBackend();
    const seed = vi.fn(() => Promise.resolve(record(5)));
    const storage = createGatedStorage<Doc>(backend, "test", { seed });
    await expect(storage.getItem("doc")).resolves.toEqual(record(5));
    expect(records.get("doc")).toEqual(record(5));
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it("does not seed over an existing or legacy record", async () => {
    const seed = vi.fn(() => Promise.resolve(record(5)));
    const own = memoryBackend({ doc: record(1) });
    await createGatedStorage<Doc>(own.backend, "test", { seed }).getItem("doc");
    const legacy = memoryBackend({ old: record(2) });
    await createGatedStorage<Doc>(legacy.backend, "test", { seed, legacyKey: "old" }).getItem(
      "doc",
    );
    expect(seed).not.toHaveBeenCalled();
  });

  it("stays closed when the seed fails", async () => {
    const { backend, records } = memoryBackend();
    const storage = createGatedStorage<Doc>(backend, "test", {
      seed: () => Promise.reject(new Error("seed failed")),
    });
    await expect(storage.getItem("doc")).rejects.toThrow("seed failed");
    void storage.setItem("doc", record(0));
    await settle();
    expect(records.has("doc")).toBe(false);
  });

  it("reports every failed write, since each can fail for another reason", async () => {
    const { backend, fail } = memoryBackend();
    const onWriteError = vi.fn();
    const storage = createGatedStorage<Doc>(backend, "test", { onWriteError });
    await storage.getItem("doc");
    fail.set = true;
    void storage.setItem("doc", record(1));
    await settle();
    void storage.setItem("doc", record(2));
    await settle();
    expect(onWriteError).toHaveBeenCalledTimes(2);
    fail.set = false;
    void storage.setItem("doc", record(3));
    await settle();
    expect(onWriteError).toHaveBeenCalledTimes(2);
  });

  it("tries a failed write again on request", async () => {
    const { backend, records, fail } = memoryBackend();
    const storage = createGatedStorage<Doc>(backend, "test");
    await storage.getItem("doc");
    fail.set = true;
    void storage.setItem("doc", record(1));
    await settle();
    expect(records.has("doc")).toBe(false);
    fail.set = false;
    storage.retry();
    await settle();
    expect(records.get("doc")).toEqual(record(1));
    // nothing left to retry
    records.delete("doc");
    storage.retry();
    await settle();
    expect(records.has("doc")).toBe(false);
  });

  it("leaves a retry to the newer value that is waiting", async () => {
    const { backend, records, fail } = memoryBackend();
    const storage = createGatedStorage<Doc>(backend, "test");
    await storage.getItem("doc");
    fail.set = true;
    void storage.setItem("doc", record(1));
    await settle();
    fail.set = false;
    void storage.setItem("doc", record(2));
    storage.retry();
    await settle();
    expect(records.get("doc")).toEqual(record(2));
  });

  it("reports the write that ends a streak of failures, and no other", async () => {
    const { backend, fail } = memoryBackend();
    const onWriteRecovered = vi.fn();
    const storage = createGatedStorage<Doc>(backend, "test", { onWriteRecovered });
    await storage.getItem("doc");
    void storage.setItem("doc", record(1));
    await settle();
    expect(onWriteRecovered).not.toHaveBeenCalled();
    fail.set = true;
    void storage.setItem("doc", record(2));
    await settle();
    fail.set = false;
    void storage.setItem("doc", record(3));
    await settle();
    void storage.setItem("doc", record(4));
    await settle();
    expect(onWriteRecovered).toHaveBeenCalledTimes(1);
  });

  describe("with a rule for states that store the same record", () => {
    const same = (a: Doc, b: Doc) => a.n === b.n;

    it("does not write back what it just read", async () => {
      const { backend, writes } = memoryBackend({ doc: record(1) });
      const storage = createGatedStorage<Doc>(backend, "test", { same });
      await storage.getItem("doc");
      void storage.setItem("doc", record(1));
      await settle();
      expect(writes()).toBe(0);
    });

    it("does not write what it last wrote", async () => {
      const { backend, writes } = memoryBackend();
      const storage = createGatedStorage<Doc>(backend, "test", { same });
      await storage.getItem("doc");
      void storage.setItem("doc", record(2));
      await settle();
      void storage.setItem("doc", record(2));
      await settle();
      expect(writes()).toBe(1);
    });

    it("writes a state that went back to the stored one after a queued change", async () => {
      const { backend, records } = memoryBackend({ doc: record(1) });
      const storage = createGatedStorage<Doc>(backend, "test", { same });
      await storage.getItem("doc");
      void storage.setItem("doc", record(2));
      void storage.setItem("doc", record(1));
      await settle();
      expect(records.get("doc")).toEqual(record(1));
    });

    it("writes a state that went back to the stored one while a write was running", async () => {
      const slow = memoryBackend({ doc: record(1) });
      let release = () => {};
      const backend: KeyValueBackend = {
        ...slow.backend,
        set: async (key, value) => {
          await new Promise<void>((resolve) => (release = resolve));
          return slow.backend.set(key, value);
        },
      };
      const storage = createGatedStorage<Doc>(backend, "test", { same });
      await storage.getItem("doc");
      void storage.setItem("doc", record(2));
      await settle();
      // record 2 is on its way; the state goes back to what is stored
      void storage.setItem("doc", record(1));
      release();
      await settle();
      release();
      await settle();
      expect(slow.records.get("doc")).toEqual(record(1));
    });

    it("writes again after a failed write, even an unchanged state", async () => {
      const { backend, records, fail } = memoryBackend({ doc: record(1) });
      const storage = createGatedStorage<Doc>(backend, "test", { same });
      await storage.getItem("doc");
      fail.set = true;
      void storage.setItem("doc", record(2));
      await settle();
      fail.set = false;
      void storage.setItem("doc", record(2));
      await settle();
      expect(records.get("doc")).toEqual(record(2));
    });

    it("writes the first state after startEmpty", async () => {
      const { backend, records, fail } = memoryBackend({ doc: "{broken" });
      const storage = createGatedStorage<Doc>(backend, "test", { same });
      await expect(storage.getItem("doc")).rejects.toThrow();
      fail.get = false;
      storage.startEmpty();
      void storage.setItem("doc", record(1));
      await settle();
      expect(records.get("doc")).toEqual(record(1));
    });
  });

  it("cancels a pending write when the record is removed", async () => {
    const { backend, records } = memoryBackend({ doc: record(1) });
    const storage = createGatedStorage<Doc>(backend, "test");
    await storage.getItem("doc");
    void storage.setItem("doc", record(2));
    void storage.removeItem("doc");
    await settle();
    expect(records.has("doc")).toBe(false);
  });
});
