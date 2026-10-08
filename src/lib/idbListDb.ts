/**
 * Generic IndexedDB-backed list-store factory.
 *
 * Sibling primitive to `createIdbStorage` in `idbStorage.ts`:
 * - `createIdbStorage` adapts Zustand persist middleware to IDB via a single
 * keyed blob (whole-state-blob serialization, debounced).
 * - `createIdbListDb` exposes typed per-record CRUD over an indexed object
 * store. Used by stores whose records are large enough that whole-state
 * serialization on every change would be catastrophic (e.g. generation
 * results carrying multi-MB base64 inputImage / controlUnits).
 *
 * Each factory call memoizes one `dbPromise`. Error rejections always emit a
 * non-null Error (project convention from commit cb661f5).
 */

interface ListDbConfig<T extends { id: string }> {
  /** IDB database name. Stable across releases; renaming creates a fresh DB. */
  dbName: string;
  /** Object store name within the database. */
  storeName: string;
  /**
   * Field on T used as the secondary index. Indexed at runtime as an IDB key
   * path string; must reference a sortable scalar (number | string) at the
   * value level. `getAll()` returns descending; `trim()` deletes ascending
   * (oldest first).
   */
  sortKey: Extract<keyof T, string>;
}

export interface IdbListDb<T extends { id: string }> {
  /** All records ordered by sortKey descending (newest first). */
  getAll(): Promise<T[]>;
  /** Single record by primary key. Resolves to undefined if absent. */
  get(id: string): Promise<T | undefined>;
  /** Insert or update by id. */
  put(item: T): Promise<void>;
  /** Delete a single record by primary key. */
  delete(id: string): Promise<void>;
  /** Delete records by primary key, in one transaction. */
  deleteMany(ids: readonly string[]): Promise<void>;
  /** If count > maxCount, delete the (count - maxCount) oldest by sortKey. */
  trim(maxCount: number): Promise<void>;
  /** Delete every record in the store. DB structure preserved. */
  clear(): Promise<void>;
}

export function createIdbListDb<T extends { id: string }>(config: ListDbConfig<T>): IdbListDb<T> {
  const { dbName, storeName, sortKey } = config;
  const DB_VERSION = 1;
  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: "id" });
          store.createIndex(sortKey, sortKey, { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
    });
    return dbPromise;
  }

  async function getAll(): Promise<T[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const index = tx.objectStore(storeName).index(sortKey);
      const out: T[] = [];
      const req = index.openCursor(null, "prev");
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          out.push(cursor.value as T);
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
    });
  }

  async function get(id: string): Promise<T | undefined> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(id);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
    });
  }

  async function put(item: T): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
    });
  }

  async function deleteOne(id: string): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
    });
  }

  async function deleteMany(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      for (const id of ids) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
    });
  }

  async function trim(maxCount: number): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      // Count and delete in one transaction: trims from two tabs then run in
      // turn, and the second sees what the first deleted.
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const counted = store.count();
      counted.onsuccess = () => {
        let excess = counted.result - maxCount;
        if (excess <= 0) return;
        const req = store.index(sortKey).openCursor(null, "next");
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor && excess > 0) {
            cursor.delete();
            excess--;
            cursor.continue();
          }
        };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
    });
  }

  async function clear(): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
    });
  }

  return { getAll, get, put, delete: deleteOne, deleteMany, trim, clear };
}
