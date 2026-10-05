import type { PersistStorage, StorageValue } from "zustand/middleware";

/** Where records live. Rejections carry a non-null Error. */
export interface KeyValueBackend {
  /** Resolves null when the key is absent. */
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

interface GatedStorageOptions<S> {
  /** Quiet time a burst of writes waits for before it reaches the backend. */
  debounceMs?: number;
  /** Record read when the store's own key is empty. Left untouched so the
   * build that wrote it can still hydrate after a rollback. */
  legacyKey?: string;
  /** Builds the first record when the store's own key and legacyKey are both
   * empty. Its result is written before the read resolves. */
  seed?: () => Promise<StorageValue<S> | null>;
  /** Called for every failed write. */
  onWriteError?: (error: unknown) => void;
  /** Called for the write that ends a streak of failures. */
  onWriteRecovered?: () => void;
  /** Whether two states would store the same record. A state that matches
   * the one last read or written is not written again. */
  same?: (a: S, b: S) => boolean;
}

export interface GatedStorage<S> extends PersistStorage<S> {
  /** Lets writes through after a failed read. The next write replaces the
   * record that could not be read. */
  startEmpty(): void;
  /** Tries the last failed write again, unless a newer one is waiting. */
  retry(): void;
}

/** Debounced PersistStorage over a key-value backend. Writes pass only once
 * the stored record has been read, so state that never saw the record cannot
 * replace it. */
export function createGatedStorage<S>(
  backend: KeyValueBackend,
  label: string,
  options: GatedStorageOptions<S> = {},
): GatedStorage<S> {
  const { debounceMs = 2000, legacyKey, seed, onWriteError, onWriteRecovered, same } = options;

  function decode(raw: unknown): StorageValue<S> | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== "string") return raw as StorageValue<S>;
    try {
      return JSON.parse(raw) as StorageValue<S>;
    } catch (cause) {
      throw new Error(`[idb] ${label}: unreadable record`, { cause });
    }
  }

  let pendingKey: string | null = null;
  let pendingValue: StorageValue<S> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The value on its way to the backend, while a write is in flight. */
  let writing: StorageValue<S> | null = null;
  let failing = false;
  let failed: { key: string; value: StorageValue<S> } | null = null;
  let open = false;
  /** What the backend holds, as far as this storage knows. */
  let stored: StorageValue<S> | null = null;

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
    writing = v;
    backend
      .set(k, v)
      .then(() => {
        stored = v;
        failed = null;
        if (failing) onWriteRecovered?.();
        failing = false;
      })
      .catch((err: unknown) => {
        console.error(`[idb] ${label}: write failed`, err);
        failed = { key: k, value: v };
        failing = true;
        onWriteError?.(err);
      })
      .finally(() => {
        writing = null;
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
    getItem: async (key) => {
      // A read in progress closes the gate again: what was queued belongs to
      // state the record is about to replace, or must not replace if it fails.
      open = false;
      pendingKey = null;
      pendingValue = null;
      failed = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      let raw = await backend.get(key);
      if (raw === null && legacyKey) raw = await backend.get(legacyKey);
      let value = decode(raw);
      if (value === null && seed) {
        value = await seed();
        if (value !== null) await backend.set(key, value);
      }
      stored = value;
      open = true;
      return value;
    },
    setItem: (key, value) => {
      if (!open) return;
      // the value a finished or running write leaves in the backend
      const latest = pendingValue ?? writing ?? stored;
      if (same && latest && same(latest.state, value.state)) return;
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
      backend.delete(key).catch((err: unknown) => {
        console.error(`[idb] ${label}: delete failed`, err);
      });
    },
    startEmpty: () => {
      stored = null;
      open = true;
    },
    retry: () => {
      if (!failed || pendingKey !== null) return;
      pendingKey = failed.key;
      pendingValue = failed.value;
      flush();
    },
  };
}

/** One object store of an IndexedDB database as a key-value backend. */
export function idbBackend(dbName: string, storeName: string): KeyValueBackend {
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
        req.onsuccess = () => {
          const db = req.result;
          // let another tab's upgrade or delete through; the next use opens again
          db.onversionchange = () => {
            db.close();
            dbPromise = null;
          };
          resolve(db);
        };
        req.onerror = () => {
          dbPromise = null;
          reject(req.error ?? new Error("IDB request failed"));
        };
      });
    }
    return dbPromise;
  }

  function write(run: (store: IDBObjectStore) => void): Promise<void> {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
          // a failed commit (quota, a Blob that cannot be stored) only aborts
          tx.onabort = () => reject(tx.error ?? new Error("IDB transaction aborted"));
          // put() throws synchronously on an uncloneable value.
          run(tx.objectStore(storeName));
          // without waiting for the request's callback, so a write issued as
          // the page goes away still lands
          tx.commit();
        }),
    );
  }

  return {
    get: (key) =>
      openDb().then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readonly");
            const req = tx.objectStore(storeName).get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
          }),
      ),
    set: (key, value) => write((store) => store.put(value, key)),
    delete: (key) => write((store) => store.delete(key)),
  };
}

/** Zustand PersistStorage backed by IndexedDB. Records are stored as
 * structured-clone objects: File and Blob fields are cloned by handle, so a
 * write costs the main thread nothing beyond the debounce. Records written
 * as JSON strings by earlier builds are still read. */
export function createIdbStorage<S>(
  dbName: string,
  storeName: string,
  options: GatedStorageOptions<S> = {},
): GatedStorage<S> {
  return createGatedStorage(idbBackend(dbName, storeName), `${dbName}/${storeName}`, options);
}
