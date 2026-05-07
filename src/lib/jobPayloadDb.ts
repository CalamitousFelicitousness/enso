import type { JobDomain, StoredJobSnapshot } from "@/stores/jobStore";
import type { JobRequest } from "@/api/types/v2";

const DB_NAME = "SDNextJobPayloads";
const STORE_NAME = "payloads";
const DB_VERSION = 1;

// Cap on retained IDB payloads. Each is ~1-5 KB (request shape + snapshot
// stripped of large blobs), so 200 ~ 1 MB ceiling. Beyond that the oldest
// records are evicted on the next write.
const MAX_PAYLOADS = 200;

export interface StoredJobPayload {
  id: string;
  domain: JobDomain;
  request: JobRequest;
  priority: number;
  snapshot: StoredJobSnapshot;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
  return dbPromise;
}

export async function putJobPayload(payload: StoredJobPayload): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(payload);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
  });
  await trimJobPayloads(MAX_PAYLOADS);
}

/** Trim to maxCount by deleting the oldest entries via the createdAt index. */
export async function trimJobPayloads(maxCount: number): Promise<void> {
  const db = await openDb();
  const count = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
  if (count <= maxCount) return;
  const toDelete = count - maxCount;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const index = tx.objectStore(STORE_NAME).index("createdAt");
    let deleted = 0;
    const req = index.openCursor(null, "next");
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor && deleted < toDelete) {
        cursor.delete();
        deleted++;
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
  });
}

export async function getJobPayload(id: string): Promise<StoredJobPayload | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result as StoredJobPayload | undefined);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
}

export async function getAllJobPayloads(): Promise<StoredJobPayload[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index("createdAt");
    const results: StoredJobPayload[] = [];
    const req = index.openCursor(null, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        results.push(cursor.value as StoredJobPayload);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
}

export async function deleteJobPayload(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
  });
}

export async function clearAllJobPayloads(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
  });
}
