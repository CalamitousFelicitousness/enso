// Loads, caches and merges the enabled autocomplete dictionaries and answers
// lookups, off the page's main thread. Uses only globals the DOM lib also
// declares, so it type-checks in the app project without the WebWorker lib.

import {
  columnsFromContent,
  findTags,
  mergeColumns,
  NO_TAGS,
  packColumns,
  unpackColumns,
  type DictColumns,
  type DictIndex,
  type PackedColumns,
  type TagMatch,
} from "@/lib/dicts/tags";
import { outdated, type Listed } from "@/lib/dicts/freshness";
import type { DictContent, DictInfo } from "./types/dict";

interface LoadRequest {
  type: "load";
  names: string[];
  baseUrl: string;
  authorization: string | null;
}

export type DictsRequest = LoadRequest | { type: "query"; id: number; text: string; limit: number };

export type DictsResponse =
  | { type: "loaded"; tags: number; failed: { name: string; message: string }[] }
  | { type: "result"; id: number; tags: TagMatch[] };

// Version 1 kept every tag as an object, which takes seconds to read back;
// version 2 had no aliases or translations.
const DB_NAME = "enso-dict-cache";
const DB_VERSION = 3;
const STORE = "dicts";

interface CacheRecord {
  columns: PackedColumns;
  /** The server's revision of what was fetched; its version on servers without one. */
  key: string;
  cachedAt: number;
}

interface Cached {
  columns: DictColumns;
  key: string;
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
    // a tab of an older build holds an older version open; go without the cache
    req.onblocked = () => reject(new Error("the dictionary cache is held by another tab"));
    req.onerror = () => reject(req.error ?? new Error("the dictionary cache could not be opened"));
  });
  return db;
}

async function readCache(name: string): Promise<Cached | null> {
  const conn = await openDb();
  const record = await new Promise<unknown>((resolve, reject) => {
    const req = conn.transaction(STORE, "readonly").objectStore(STORE).get(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("the dictionary cache could not be read"));
  });
  const { columns, key, cachedAt } = (record ?? {}) as Partial<CacheRecord>;
  const unpacked = unpackColumns(columns);
  if (!unpacked || typeof key !== "string" || typeof cachedAt !== "number") return null;
  return { columns: unpacked, key, cachedAt };
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

function headersFor(req: LoadRequest): Record<string, string> {
  return {
    Accept: "application/json",
    ...(req.authorization !== null && { Authorization: req.authorization }),
  };
}

/** Each dictionary the server lists, by name. */
async function fetchListing(req: LoadRequest): Promise<Map<string, Listed>> {
  const res = await fetch(`${req.baseUrl}/sdapi/v1/autocomplete`, { headers: headersFor(req) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = await res.json();
  const listed = new Map<string, Listed>();
  if (!Array.isArray(items)) return listed;
  for (const item of items as Partial<DictInfo>[]) {
    if (typeof item.name !== "string") continue;
    if (typeof item.revision === "string") {
      listed.set(item.name, { key: item.revision, exact: true });
    } else {
      listed.set(item.name, { key: item.version ?? "", exact: false });
    }
  }
  return listed;
}

async function fetchDictionary(
  name: string,
  req: LoadRequest,
  listed: Listed | undefined,
): Promise<DictColumns> {
  const url = `${req.baseUrl}/sdapi/v1/autocomplete/${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: headersFor(req) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const content = (await res.json()) as Partial<DictContent>;
  if (!Array.isArray(content.tags)) throw new Error("the answer holds no tags");
  const columns = columnsFromContent(content.tags, content.translations);
  const key = content.revision ?? listed?.key ?? content.version ?? "";
  const record = { columns: packColumns(columns), key, cachedAt: Date.now() };
  void writeCache(name, record).catch(() => {});
  return columns;
}

let index: DictIndex = NO_TAGS;
let generation = 0;

/** Answer from the cached copies at once, then fetch what the server has
 * changed since; dictionaries are merged in as they arrive, those arriving
 * together once. A copy the server cannot replace stays in use. */
async function load(req: LoadRequest): Promise<void> {
  const current = ++generation;
  const loaded: (DictColumns | null)[] = req.names.map(() => null);
  const failed: { name: string; message: string }[] = [];
  const merge = () => {
    index = mergeColumns(loaded.filter((columns) => columns !== null));
  };
  let queued = false;
  let settled = false;
  const arrived = (i: number, columns: DictColumns) => {
    loaded[i] = columns;
    if (queued || current !== generation) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      if (!settled && current === generation) merge();
    }, 0);
  };
  const listing = fetchListing(req).catch(() => null);
  await Promise.all(
    req.names.map(async (name, i) => {
      const cached = await readCache(name).catch(() => null);
      if (cached) arrived(i, cached.columns);
      const listed = (await listing)?.get(name);
      if (cached && !outdated(cached, listed, Date.now())) return;
      try {
        arrived(i, await fetchDictionary(name, req, listed));
      } catch (err) {
        if (!cached)
          failed.push({ name, message: err instanceof Error ? err.message : String(err) });
      }
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
