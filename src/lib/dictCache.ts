import type { DictTag } from "@/api/types/dict";

const DB_NAME = "enso-dict-cache";
const STORE_NAME = "dicts";
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedEntry {
  tags: DictTag[];
  version: string;
  cachedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(key: string): Promise<CachedEntry | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result as CachedEntry | undefined);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbPut(key: string, value: CachedEntry): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function idbDelete(key?: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        if (key) {
          tx.objectStore(STORE_NAME).delete(key);
        } else {
          tx.objectStore(STORE_NAME).clear();
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

/** Get cached dict tags, or null if missing or expired. */
export async function getCachedDict(
  name: string,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Promise<DictTag[] | null> {
  try {
    const entry = await idbGet(name);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > maxAgeMs) return null;
    return entry.tags;
  } catch {
    return null;
  }
}

/** Store dict tags in IDB cache. */
export async function setCachedDict(
  name: string,
  tags: DictTag[],
  version: string,
): Promise<void> {
  try {
    await idbPut(name, { tags, version, cachedAt: Date.now() });
  } catch {
    // silently fail — cache is best-effort
  }
}

/** Clear cached dict data. Pass name for a single dict, omit for all. */
export async function clearDictCache(name?: string): Promise<void> {
  try {
    await idbDelete(name);
  } catch {
    // silently fail
  }
}
