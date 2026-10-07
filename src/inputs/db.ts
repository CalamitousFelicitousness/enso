// The enso-inputs database. Documents name their pictures by cid; the bytes
// live in the blobs store, written once each, because the browser copies every
// Blob held in a record each time that record is put.

import { planSweep, type Orphans } from "@/lib/inputs/sweep";

const NAME = "enso-inputs";
const VERSION = 4;
const BLOBS = "blobs";
const META = "meta";
const ORPHANS = "orphans";
const LOCK = "enso-inputs";

/** Stores whose records name blobs. A store added here needs a reader in
 * every sweep call, or sweeps stop. */
export const DOCUMENTS = "documents";
/** The frames each job was sent with, by the key its result carries. */
export const SNAPSHOTS = "snapshots";
/** What user actions removed, kept until its record expires. */
export const TRASH = "trash";
/** The maps processors made, by map key, kept until a record expires. */
export const MAPS = "maps";

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
    req.onupgradeneeded = () => {
      for (const store of [DOCUMENTS, SNAPSHOTS, TRASH, MAPS, BLOBS, META]) {
        if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store);
      }
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
  const db = await open();
  const tx = db.transaction(store, "readwrite");
  const done = finished(tx);
  tx.objectStore(store).delete(key);
  await done;
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

/** Reads one record of a document store: the cids it names, and when it may
 * be dropped (epoch ms), if ever. Throws on a record it cannot account for. */
export type StoreReader = (record: unknown) => { cids: string[]; expiresAt?: number };

/** A reader per document store. */
export type StoreReaders = Record<string, StoreReader>;

/** Delete expired records, blobs no document names any more (per planSweep)
 * and the revision claims, which only matter between tabs open at the same
 * time. Everything is read and deleted in one transaction, and nothing is
 * deleted unless every record of every document store was read. */
async function sweep(readers: StoreReaders): Promise<void> {
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
  try {
    const named = new Set<string>();
    for (const name of documentStores) {
      const store = tx.objectStore(name);
      const records: unknown[] = await result(store.getAll());
      const keys = await result(store.getAllKeys());
      records.forEach((record, i) => {
        const read = readers[name](record);
        if (read.expiresAt !== undefined && read.expiresAt <= now) {
          store.delete(keys[i]);
          return;
        }
        for (const cid of read.cids) named.add(cid);
      });
    }
    const keys = (await result(tx.objectStore(BLOBS).getAllKeys())).filter(
      (key) => typeof key === "string",
    );
    const orphans = ((await result(tx.objectStore(META).get(ORPHANS))) ?? {}) as Orphans;
    const plan = planSweep(keys, named, orphans, now);
    for (const key of plan.remove) tx.objectStore(BLOBS).delete(key);
    tx.objectStore(META).put(plan.orphans, ORPHANS);
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
}

let entered: Promise<void> | null = null;

/** Called once per page before anything is hydrated. Sweeps when no other tab
 * of the app is open, then holds the shared lock for the life of the page, so
 * a sweep only ever runs while what the stores name on disk is every live
 * reference there is. Without Web Locks nothing is swept. */
export function enterTab(readers: StoreReaders): Promise<void> {
  entered ??= (async () => {
    if (!("locks" in navigator)) return;
    await navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
      if (lock) {
        await sweep(readers).catch((err: unknown) => {
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
