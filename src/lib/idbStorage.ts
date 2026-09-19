import type { PersistStorage, StorageValue } from "zustand/middleware";

interface IdbStorageOptions {
  /** Quiet time a burst of writes waits for before it reaches IndexedDB. */
  debounceMs?: number;
  /** Record read when the store's own key is empty. Left untouched so the
   * build that wrote it can still hydrate after a rollback. */
  legacyKey?: string;
}

/** Zustand PersistStorage backed by IndexedDB. Records are stored as
 * structured-clone objects: File and Blob fields are cloned by handle, so a
 * write costs the main thread nothing beyond the debounce. Records written
 * as JSON strings by earlier builds are still read. */
export function createIdbStorage<S>(
  dbName: string,
  storeName: string,
  options: IdbStorageOptions = {},
): PersistStorage<S> {
  const { debounceMs = 2000, legacyKey } = options;
  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(storeName)) {
            req.result.createObjectStore(storeName);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
      });
    }
    return dbPromise;
  }

  function idbGet(key: string): Promise<unknown> {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, "readonly");
          const req = tx.objectStore(storeName).get(key);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
        }),
    );
  }

  function idbSet(key: string, value: unknown): Promise<void> {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          // put() throws synchronously on an uncloneable value.
          tx.objectStore(storeName).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
        }),
    );
  }

  function idbDelete(key: string): Promise<void> {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
        }),
    );
  }

  function decode(raw: unknown): StorageValue<S> | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== "string") return raw as StorageValue<S>;
    try {
      return JSON.parse(raw) as StorageValue<S>;
    } catch (err) {
      console.error(`[idb] ${dbName}/${storeName}: unreadable record`, err);
      return null;
    }
  }

  let pendingKey: string | null = null;
  let pendingValue: StorageValue<S> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing = false;
  let reportedFailure = false;

  // Gate: suppress writes until the first getItem settles (hydration
  // complete). Without this, Zustand persist middleware can queue a setItem
  // with pre-hydration (empty/default) state before hydration finishes
  // reading from IDB, and the debounced flush writes that stale state over
  // the real data.
  let hydrated = false;

  function flush() {
    if (writing || pendingKey === null || pendingValue === null) return;
    const k = pendingKey;
    const v = pendingValue;
    pendingKey = null;
    pendingValue = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    writing = true;
    idbSet(k, v)
      .catch((err: unknown) => {
        if (reportedFailure) return;
        reportedFailure = true;
        console.error(`[idb] ${dbName}/${storeName}: write failed`, err);
      })
      .finally(() => {
        writing = false;
        if (pendingKey !== null) flush();
      });
  }

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  return {
    getItem: (key) =>
      idbGet(key)
        .then((raw) => (raw === null && legacyKey ? idbGet(legacyKey) : raw))
        .then(decode)
        .finally(() => {
          hydrated = true;
        }),
    setItem: (key, value) => {
      if (!hydrated) return;
      pendingKey = key;
      pendingValue = value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    },
    removeItem: (key) => {
      pendingKey = null;
      pendingValue = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      idbDelete(key).catch((err: unknown) => {
        console.error(`[idb] ${dbName}/${storeName}: delete failed`, err);
      });
    },
  };
}
