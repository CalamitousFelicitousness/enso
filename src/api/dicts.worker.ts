// Loads, caches and merges the enabled autocomplete dictionaries and answers
// lookups, off the page's main thread. Uses only globals the DOM lib also
// declares, so it type-checks in the app project without the WebWorker lib.

import {
  columnsFromRows,
  findTags,
  mergeColumns,
  NO_TAGS,
  packColumns,
  unpackColumns,
  type DictColumns,
  type PackedColumns,
} from "@/lib/dicts/tags";
import type { DictContent, DictTag } from "./types/dict";

interface LoadRequest {
  type: "load";
  names: string[];
  baseUrl: string;
  authorization: string | null;
}

export type DictsRequest = LoadRequest | { type: "query"; id: number; text: string; limit: number };

export type DictsResponse =
  | { type: "loaded"; tags: number; failed: { name: string; message: string }[] }
  | { type: "result"; id: number; tags: DictTag[] };

// Version 1 kept every tag as an object, which takes seconds to read back.
const DB_NAME = "enso-dict-cache";
const DB_VERSION = 2;
const STORE = "dicts";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface CacheRecord {
  columns: PackedColumns;
  version: string;
  cachedAt: number;
}

let db: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const conn = req.result;
      if (conn.objectStoreNames.contains(STORE)) conn.deleteObjectStore(STORE);
      conn.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    // a tab of an older build holds version 1 open; go without the cache
    req.onblocked = () => reject(new Error("the dictionary cache is held by another tab"));
    req.onerror = () => reject(req.error ?? new Error("the dictionary cache could not be opened"));
  });
  return db;
}

async function readCache(name: string): Promise<{ columns: DictColumns; fresh: boolean } | null> {
  const conn = await openDb();
  const record = await new Promise<unknown>((resolve, reject) => {
    const req = conn.transaction(STORE, "readonly").objectStore(STORE).get(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("the dictionary cache could not be read"));
  });
  const { columns, cachedAt } = (record ?? {}) as Partial<CacheRecord>;
  const unpacked = unpackColumns(columns);
  if (!unpacked || typeof cachedAt !== "number") return null;
  return { columns: unpacked, fresh: Date.now() - cachedAt <= MAX_AGE_MS };
}

async function writeCache(name: string, record: CacheRecord): Promise<void> {
  const conn = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = conn.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record, name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("the dictionary cache could not be written"));
  });
}

async function fetchDictionary(name: string, req: LoadRequest): Promise<DictColumns> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(req.authorization !== null && { Authorization: req.authorization }),
  };
  const url = `${req.baseUrl}/sdapi/v1/autocomplete/${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const content = (await res.json()) as Partial<DictContent>;
  if (!Array.isArray(content.tags)) throw new Error("the answer holds no tags");
  const columns = columnsFromRows(content.tags);
  const record = {
    columns: packColumns(columns),
    version: content.version ?? "",
    cachedAt: Date.now(),
  };
  void writeCache(name, record).catch(() => {});
  return columns;
}

/** The cached copy while it is under a day old, else the server's; a stale
 * copy when the server cannot answer. */
async function dictionary(name: string, req: LoadRequest): Promise<DictColumns> {
  const cached = await readCache(name).catch(() => null);
  if (cached?.fresh) return cached.columns;
  try {
    return await fetchDictionary(name, req);
  } catch (err) {
    if (cached) return cached.columns;
    throw err;
  }
}

let index: DictColumns = NO_TAGS;
let generation = 0;

/** Merge the dictionaries in as they arrive, those arriving together once. */
async function load(req: LoadRequest): Promise<void> {
  const current = ++generation;
  const loaded: (DictColumns | null)[] = req.names.map(() => null);
  const failed: { name: string; message: string }[] = [];
  const merge = () => {
    index = mergeColumns(loaded.filter((columns) => columns !== null));
  };
  let queued = false;
  let settled = false;
  await Promise.all(
    req.names.map(async (name, i) => {
      try {
        loaded[i] = await dictionary(name, req);
      } catch (err) {
        failed.push({ name, message: err instanceof Error ? err.message : String(err) });
        return;
      }
      if (queued || current !== generation) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        if (!settled && current === generation) merge();
      }, 0);
    }),
  );
  settled = true;
  if (current !== generation) return;
  merge();
  postMessage({ type: "loaded", tags: index.names.length, failed } satisfies DictsResponse);
}

addEventListener("message", (event: MessageEvent<DictsRequest>) => {
  const req = event.data;
  if (req.type === "load") {
    void load(req);
    return;
  }
  const tags = findTags(index, req.text, req.limit);
  postMessage({ type: "result", id: req.id, tags } satisfies DictsResponse);
});
