import { afterEach, describe, expect, it, vi } from "vitest";
import type { StorageProblem } from "@/lib/storageHealth";

function memoryStorage(fail = false) {
  const items = new Map<string, string>();
  return {
    items,
    get length() {
      return items.size;
    },
    key: (i: number) => [...items.keys()][i] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (fail) throw new DOMException("full", "QuotaExceededError");
      items.set(key, value);
    },
    removeItem: (key: string) => void items.delete(key),
  };
}

/** The module with fresh state, and the problems it reports. */
async function load() {
  vi.resetModules();
  const problems: StorageProblem[] = [];
  const health = await import("@/lib/storageHealth");
  health.onStorageProblem((p) => problems.push(p));
  const local = await import("./local");
  return { ...local, problems };
}

describe("the local door", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the global at call time", async () => {
    const { readLocal, writeLocal } = await load();
    const first = memoryStorage();
    vi.stubGlobal("localStorage", first);
    writeLocal("enso-ui", "a");
    expect(first.items.get("enso-ui")).toBe("a");
    const second = memoryStorage();
    vi.stubGlobal("localStorage", second);
    expect(readLocal("enso-ui")).toBeNull();
  });

  it("treats a missing storage as empty and says once that nothing is kept", async () => {
    const { readLocal, writeLocal, localKeys, problems } = await load();
    vi.stubGlobal("localStorage", undefined);
    expect(readLocal("enso-ui")).toBeNull();
    expect(localKeys()).toEqual([]);
    writeLocal("enso-ui", "a");
    writeLocal("enso-ui", "b");
    expect(problems).toEqual([
      {
        kind: "write",
        id: "local-storage",
        what: "settings",
        reason: "This browser does not let Enso keep them.",
      },
    ]);
  });

  it("reports a refused write once and its recovery once", async () => {
    const { writeLocal, problems } = await load();
    vi.stubGlobal("localStorage", memoryStorage(true));
    writeLocal("enso-ui", "a");
    writeLocal("enso-ui", "b");
    expect(problems).toEqual([{ kind: "write", id: "local-storage", what: "settings" }]);
    vi.stubGlobal("localStorage", memoryStorage());
    writeLocal("enso-ui", "c");
    writeLocal("enso-ui", "d");
    expect(problems.at(-1)).toEqual({ kind: "resolved", id: "local-storage" });
    expect(problems).toHaveLength(2);
  });

  it("keeps a store's state as JSON under its name and reads it back at creation", async () => {
    const { persistLocal } = await load();
    const { create } = await import("zustand");
    const storage = memoryStorage();
    storage.items.set("enso-ui", '{"state":{"n":3},"version":2}');
    vi.stubGlobal("localStorage", storage);
    const useCounter = create<{ n: number; other: string; setN: (n: number) => void }>()(
      persistLocal((set) => ({ n: 0, other: "x", setN: (n) => set({ n }) }), {
        name: "enso-ui",
        version: 2,
        partialize: (s) => ({ n: s.n }),
      }),
    );
    expect(useCounter.getState().n).toBe(3);
    useCounter.getState().setN(4);
    expect(storage.items.get("enso-ui")).toBe('{"state":{"n":4},"version":2}');
  });

  it("lists every key the storage holds", async () => {
    const { localKeys } = await load();
    const storage = memoryStorage();
    storage.items.set("enso-ui", "1");
    storage.items.set("modalZoom", "2");
    vi.stubGlobal("localStorage", storage);
    expect(localKeys().sort()).toEqual(["enso-ui", "modalZoom"]);
  });
});
