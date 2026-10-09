import type { CachedThumb } from "@/api/types/gallery";

const DB_NAME = "SDNextReact";
const STORE_NAME = "thumbs";
const DB_VERSION = 3;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // V3: keyed by the file path; V2 keyed by its SHA-256, which plain http cannot compute
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      const store = db.createObjectStore(STORE_NAME, { keyPath: "path" });
      store.createIndex("folder", "folder", { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
  return dbPromise;
}

/** A file's cached thumb, by its path: no API call on a hit. */
export async function getThumb(path: string): Promise<CachedThumb | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(path);
    req.onsuccess = () => resolve(req.result as CachedThumb | undefined);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
}

/** Batch-get multiple thumbs in a single transaction. */
export async function batchGetThumbs(paths: string[]): Promise<Map<string, CachedThumb>> {
  if (paths.length === 0) return new Map();
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const map = new Map<string, CachedThumb>();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    let pending = paths.length;
    for (const path of paths) {
      const req = store.get(path);
      req.onsuccess = () => {
        if (req.result) map.set(path, req.result as CachedThumb);
        if (--pending === 0) resolve(map);
      };
      req.onerror = () => {
        if (--pending === 0) resolve(map);
      };
    }
    tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
  });
}

export async function putThumb(entry: CachedThumb): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
  });
}

export async function deleteFolder(folder: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("folder");
    const req = index.openCursor(IDBKeyRange.only(folder));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
  });
}

export async function deleteThumbs(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const path of paths) store.delete(path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
  });
}

export async function cleanupFolder(folder: string, maxEntries: number): Promise<void> {
  const db = await openDb();
  const entries = await new Promise<CachedThumb[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index("folder");
    const req = index.getAll(IDBKeyRange.only(folder));
    req.onsuccess = () => resolve(req.result as CachedThumb[]);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
  if (entries.length <= maxEntries) return;
  entries.sort((a, b) => a.mtime - b.mtime);
  const toDelete = entries.slice(0, entries.length - maxEntries);
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  for (const entry of toDelete) {
    store.delete(entry.path);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
  });
}
