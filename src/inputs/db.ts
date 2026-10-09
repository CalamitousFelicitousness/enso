// The enso-inputs database. Documents name their pictures by cid; the bytes
// live in the blobs store, written once each, because the browser copies every
// Blob held in a record each time that record is put.

import { BLOBS, JOBS, JOBS_BY_CREATION, META, READERS, STORES } from "@/lib/inputs/storeLayout";
import {
  planSweep,
  readForSweep,
  type Orphans,
  type StoreReader,
  type StoreRecords,
  type SweepPlan,
} from "@/lib/inputs/sweep";

const NAME = "enso-inputs";
const VERSION = 6;
const ORPHANS = "orphans";
const LOCK = "enso-inputs";

/** The database was created by a build with a newer layout. */
export class NewerDatabase extends Error {
  override name = "NewerDatabase";
}

/** Another tab stored this revision of the document first. */
export class DocumentConflict extends Error {
  override name = "DocumentConflict";
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    // Creates what a version lacks and moves no data, so an upgrade cannot fail on a record
    req.onupgradeneeded = () => {
      for (const store of STORES) {
        if (req.result.objectStoreNames.contains(store)) continue;
        const created = req.result.createObjectStore(store);
        if (store === JOBS) created.createIndex(JOBS_BY_CREATION, "createdAt");
      }
    };
    req.onblocked = () => {
      console.warn(`[inputs] ${NAME} waits for another tab to close it before it can upgrade`);
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab is upgrading: let it, and open again on the next use
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(
        req.error?.name === "VersionError"
          ? new NewerDatabase(`${NAME} was created by a newer version of the app`)
          : (req.error ?? new Error("IDB open failed")),
      );
    };
  });
  return opening;
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IDB transaction aborted"));
  });
}

/** Blob keys this page has seen in the store: read from it or written by it. */
const held = new Set<string>();

/** A document and the blobs it names, read in one transaction. `parse` checks
 * the record and may throw; null when there is no record. */
export async function readDocument<T>(
  store: string,
  key: string,
  parse: (record: unknown) => T,
  cidsOf: (document: T) => string[],
): Promise<{ document: T; blobs: Map<string, Blob> } | null> {
  const db = await open();
  const tx = db.transaction([store, BLOBS], "readonly");
  const record: unknown = await result(tx.objectStore(store).get(key));
  if (record === undefined) return null;
  const document = parse(record);
  const blobs = new Map<string, Blob>();
  await Promise.all(
    cidsOf(document).map(async (cid) => {
      const blob: unknown = await result(tx.objectStore(BLOBS).get(cid));
      if (blob instanceof Blob) {
        blobs.set(cid, blob);
        held.add(cid);
      }
    }),
  );
  return { document, blobs };
}

// A revision of a document is claimed by adding this key, which only one
// writer can do. Claims are cleared by the sweep, when no other tab is open.
const CLAIM = "rev:";
const claimKey = (store: string, key: string, revision: number) =>
  `${CLAIM}${store}:${key}:${String(revision).padStart(12, "0")}`;

/** The highest revision of a document any tab has claimed; 0 when none has. */
export async function latestRevision(store: string, key: string): Promise<number> {
  const db = await open();
  const range = IDBKeyRange.bound(claimKey(store, key, 0), claimKey(store, key, 999_999_999_999));
  const keys = await result(db.transaction(META, "readonly").objectStore(META).getAllKeys(range));
  const last = keys.at(-1);
  return typeof last === "string" ? Number(last.slice(last.lastIndexOf(":") + 1)) : 0;
}

/** Store a document as `revision`, with every blob it names that this page
 * has not seen in the store, in one transaction. A blob already stored is
 * left alone. Rejects with DocumentConflict, and writes nothing, when another
 * tab has stored that revision.
 *
 * Every request is issued at once and the transaction is told to commit, so a
 * write started as the page goes away lands whole or not at all. */
export function writeDocument(
  store: string,
  key: string,
  record: unknown,
  blobs: ReadonlyMap<string, Blob>,
  revision: number,
): Promise<void> {
  return write(store, key, record, blobs, revision);
}

/** Store a record nobody else claims, such as a cached map: the same write
 * without a revision, so the last writer wins. */
export function writeRecord(
  store: string,
  key: string,
  record: unknown,
  blobs: ReadonlyMap<string, Blob>,
): Promise<void> {
  return write(store, key, record, blobs, null);
}

async function write(
  store: string,
  key: string,
  record: unknown,
  blobs: ReadonlyMap<string, Blob>,
  revision: number | null,
): Promise<void> {
  const db = await open();
  const tx = db.transaction([store, BLOBS, META], "readwrite");
  const done = finished(tx);
  let conflict = false;
  if (revision !== null) {
    const claim = tx.objectStore(META).add(true, claimKey(store, key, revision));
    claim.onerror = () => {
      conflict = claim.error?.name === "ConstraintError";
    };
  }
  const fresh = [...blobs].filter(([cid]) => !held.has(cid));
  for (const [cid, blob] of fresh) tx.objectStore(BLOBS).put(blob, cid);
  tx.objectStore(store).put(record, key);
  tx.commit();
  try {
    await done;
  } catch (err) {
    throw conflict ? new DocumentConflict(`${store}/${key} was stored by another tab`) : err;
  }
  for (const [cid] of fresh) held.add(cid);
  void restoreMissing(blobs);
}

/** Put back blobs this page holds and the store has lost. Nothing in the app
 * deletes a blob while a page that names it is open, so this only ever acts
 * after outside interference; it costs one key listing per save. */
async function restoreMissing(blobs: ReadonlyMap<string, Blob>): Promise<void> {
  try {
    const db = await open();
    const keys = new Set(await result(db.transaction(BLOBS).objectStore(BLOBS).getAllKeys()));
    const missing = [...blobs].filter(([cid]) => !keys.has(cid));
    if (missing.length === 0) return;
    const tx = db.transaction(BLOBS, "readwrite");
    const done = finished(tx);
    for (const [cid, blob] of missing) tx.objectStore(BLOBS).put(blob, cid);
    tx.commit();
    await done;
  } catch (err) {
    console.error("[inputs] could not check the stored pictures", err);
  }
}

export async function deleteDocument(store: string, key: string): Promise<void> {
  return deleteRecords(store, [key]);
}

/** Delete records by key, in one transaction. */
export async function deleteRecords(store: string, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await open();
  const tx = db.transaction(store, "readwrite");
  const done = finished(tx);
  for (const key of keys) tx.objectStore(store).delete(key);
  tx.commit();
  await done;
}

/** Change a record where it is: read and put back in one transaction, so a
 * change from another tab in between is not overwritten. Nothing is written
 * when there is no record or `change` returns null; a `change` that throws
 * writes nothing and rejects. True when a record was written. */
export async function updateRecord(
  store: string,
  key: string,
  change: (record: unknown) => unknown,
): Promise<boolean> {
  const db = await open();
  const tx = db.transaction(store, "readwrite");
  const done = finished(tx);
  let changed: unknown;
  try {
    const record: unknown = await result(tx.objectStore(store).get(key));
    changed = record === undefined ? null : change(record);
    if (changed !== null) tx.objectStore(store).put(changed, key);
    tx.commit();
  } catch (err) {
    done.catch(() => {});
    try {
      tx.abort();
    } catch {
      // already finished
    }
    throw err;
  }
  await done;
  return changed !== null;
}

/** What a rewrite puts: records by key, the blobs they name, and what the
 * caller learns from it. */
export interface Rewrite<T> {
  put: ReadonlyMap<string, unknown>;
  blobs: ReadonlyMap<string, Blob>;
  result: T;
}

/** Read every record of a store, decide from them what to put, and put it
 * with any blob this page has not seen stored, in one transaction, so no
 * other tab's write lands between the read and the put. `decide` returns
 * null to put nothing; one that throws puts nothing and rejects. */
export async function rewriteStore<T>(
  store: string,
  decide: (records: ReadonlyMap<string, unknown>) => Rewrite<T> | null,
): Promise<T | null> {
  const db = await open();
  const tx = db.transaction([store, BLOBS], "readwrite");
  const done = finished(tx);
  let outcome: Rewrite<T> | null;
  let fresh: [string, Blob][] = [];
  try {
    const os = tx.objectStore(store);
    const keys = await result(os.getAllKeys());
    const values: unknown[] = await result(os.getAll());
    const records = new Map<string, unknown>();
    keys.forEach((key, i) => {
      if (typeof key === "string") records.set(key, values[i]);
    });
    outcome = decide(records);
    if (outcome) {
      fresh = [...outcome.blobs].filter(([cid]) => !held.has(cid));
      for (const [cid, blob] of fresh) tx.objectStore(BLOBS).put(blob, cid);
      for (const [key, value] of outcome.put) os.put(value, key);
    }
    tx.commit();
  } catch (err) {
    done.catch(() => {});
    try {
      tx.abort();
    } catch {
      // already finished
    }
    throw err;
  }
  await done;
  if (!outcome) return null;
  for (const [cid] of fresh) held.add(cid);
  void restoreMissing(outcome.blobs);
  return outcome.result;
}

/** The keys of a store's records. */
export async function allKeys(store: string): Promise<IDBValidKey[]> {
  const db = await open();
  return result(db.transaction(store, "readonly").objectStore(store).getAllKeys());
}

/** The records of a store with their keys. */
export async function readAllRecords(store: string): Promise<[IDBValidKey, unknown][]> {
  const db = await open();
  const os = db.transaction(store, "readonly").objectStore(store);
  const [keys, records] = await Promise.all([result(os.getAllKeys()), result(os.getAll())]);
  return keys.map((key, i) => [key, records[i]]);
}

/** Records by key, read in one transaction; a key without a record is left out. */
export async function readRecords(
  store: string,
  keys: readonly string[],
): Promise<Map<string, unknown>> {
  const db = await open();
  const os = db.transaction(store, "readonly").objectStore(store);
  const found = new Map<string, unknown>();
  await Promise.all(
    keys.map(async (key) => {
      const record: unknown = await result(os.get(key));
      if (record !== undefined) found.set(key, record);
    }),
  );
  return found;
}

/** An index's entries without their records: the index key and the record's
 * key, in index order. */
export async function indexEntries(
  store: string,
  index: string,
): Promise<{ key: IDBValidKey; primaryKey: IDBValidKey }[]> {
  const db = await open();
  const req = db.transaction(store, "readonly").objectStore(store).index(index).openKeyCursor();
  return new Promise((resolve, reject) => {
    const entries: { key: IDBValidKey; primaryKey: IDBValidKey }[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(entries);
        return;
      }
      entries.push({ key: cursor.key, primaryKey: cursor.primaryKey });
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
}

/** The keys whose Blob can no longer be read, such as a dropped file that was
 * moved or changed since. */
export async function unreadableBlobs(blobs: ReadonlyMap<string, Blob>): Promise<string[]> {
  const checked = await Promise.all(
    [...blobs].map(async ([key, blob]) => {
      try {
        await blob.slice(0, 1).arrayBuffer();
        return null;
      } catch {
        return key;
      }
    }),
  );
  return checked.filter(Boolean);
}

async function putMeta(key: string, value: unknown): Promise<void> {
  const db = await open();
  const tx = db.transaction(META, "readwrite");
  const done = finished(tx);
  tx.objectStore(META).put(value, key);
  tx.commit();
  await done;
}

/** Delete expired records, blobs no document names any more (per planSweep:
 * at once for what the trash held) and the revision claims, which only
 * matter between tabs open at the same time. Everything is read and deleted
 * in one transaction, and nothing is deleted unless every record of every
 * document store was read. The transaction only deletes, so a full disk does
 * not stop it; the orphan map is written after, and without it each unnamed
 * blob starts its grace again. */
async function sweep(readers: Readonly<Record<string, StoreReader>>): Promise<void> {
  const db = await open();
  const names = [...db.objectStoreNames];
  const documentStores = names.filter((name) => name !== BLOBS && name !== META);
  const unread = documentStores.filter((name) => !Object.hasOwn(readers, name));
  if (unread.length > 0) {
    console.warn(`[inputs] no sweep: no reader for ${unread.join(", ")}`);
    return;
  }
  const now = Date.now();
  const tx = db.transaction(names, "readwrite");
  const done = finished(tx);
  let plan: SweepPlan;
  try {
    const stores: StoreRecords<IDBValidKey>[] = [];
    for (const name of documentStores) {
      const store = tx.objectStore(name);
      const records: unknown[] = await result(store.getAll());
      const keys = await result(store.getAllKeys());
      stores.push({ store: name, keys, records });
    }
    const reading = readForSweep(stores, readers, now);
    for (const { store, key } of reading.expired) tx.objectStore(store).delete(key);
    const keys = (await result(tx.objectStore(BLOBS).getAllKeys())).filter(
      (key) => typeof key === "string",
    );
    const orphans = ((await result(tx.objectStore(META).get(ORPHANS))) ?? {}) as Orphans;
    plan = planSweep(keys, reading.named, orphans, now, reading.urgent);
    for (const key of plan.remove) tx.objectStore(BLOBS).delete(key);
    tx.objectStore(META).delete(ORPHANS);
    tx.objectStore(META).delete(IDBKeyRange.bound(CLAIM, `${CLAIM}￿`));
  } catch (err) {
    done.catch(() => {});
    try {
      tx.abort();
    } catch {
      // already finished
    }
    throw err;
  }
  await done;
  await putMeta(ORPHANS, plan.orphans).catch((err: unknown) => {
    console.warn("[inputs] could not store when unused pictures were first seen", err);
  });
}

let entered: Promise<void> | null = null;

/** Called once per page before anything is hydrated. Sweeps when no other tab
 * of the app is open, then holds the shared lock for the life of the page, so
 * a sweep only ever runs while what the stores name on disk is every live
 * reference there is. Without Web Locks nothing is swept. */
export function enterTab(): Promise<void> {
  entered ??= (async () => {
    if (!("locks" in navigator)) return;
    await navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
      if (lock) {
        await sweep(READERS).catch((err: unknown) => {
          console.error("[inputs] sweep failed; nothing was deleted", err);
        });
      }
      // Queued behind the exclusive lock while it is held, so no other tab
      // can sweep between its release and this grant.
      void navigator.locks.request(LOCK, { mode: "shared" }, () => new Promise<never>(() => {}));
    });
  })();
  return entered;
}
