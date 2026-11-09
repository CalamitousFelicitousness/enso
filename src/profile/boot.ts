// Page start, before the app and its stores exist: a reset asked for on the
// last page is carried out here, where nothing is open that could write
// back; then the first-run marker is judged and the page joins the tabs.

import { openExisting } from "@/lib/idbStorage";
import { JOBS, LIBRARY } from "@/lib/inputs/storeLayout";
import { MANIFEST } from "@/lib/profile/manifest";
import { DB, LOCAL, LOCAL_PREFIX, type DbName } from "@/lib/profile/names";
import { emptiesDocument, planReset, rewriteRecord } from "@/lib/profile/plan";
import {
  isStale,
  readResetRecord,
  writeResetRecord,
  type ResetNote,
  type ResetRecord,
} from "@/lib/profile/record";
import { RESETTING_LINE } from "@/lib/profile/text";
import { countRecords, enterTab, resetInputs, withInputsBarrier } from "@/inputs/db";
import { legacyMarks } from "@/inputs/legacySources";
import { announceDone, listenForResets } from "./channel";
import { localKeys, readLocal, removeLocal, removeLocalKeys, writeLocal } from "./local";
import { startProfile } from "./marker";

/** How long the reset waits for the page it replaces to let go of the lock. */
const BARRIER_WAIT_MS = 2_000;
const POLL_MS = 250;
/** How long a database still held open may hold up the reset. */
const DELETE_WAIT_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function current(): ResetRecord | null {
  return readResetRecord(readLocal(LOCAL.reset));
}

function store(record: ResetRecord): void {
  writeLocal(LOCAL.reset, writeResetRecord(record));
}

function deleteDatabase(name: string): Promise<"deleted" | "blocked"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("blocked"), DELETE_WAIT_MS);
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve("deleted");
    };
    req.onerror = () => {
      clearTimeout(timer);
      resolve("blocked");
    };
  });
}

/** Databases of other builds: Enso's prefix, not in the manifest. */
async function strayDatabases(): Promise<string[]> {
  const known = new Set<string>(Object.values(DB));
  try {
    const listed = await indexedDB.databases();
    return listed.flatMap((d) =>
      d.name && d.name.startsWith(LOCAL_PREFIX) && !known.has(d.name) ? [d.name] : [],
    );
  } catch {
    return [];
  }
}

async function deleteRecords(db: DbName, store: string, keys: readonly string[]): Promise<void> {
  const conn = await openExisting(db);
  if (!conn) return;
  try {
    if (!conn.objectStoreNames.contains(store)) return;
    await new Promise<void>((resolve, reject) => {
      const tx = conn.transaction(store, "readwrite");
      for (const key of keys) tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IDB transaction aborted"));
    });
  } finally {
    conn.close();
  }
}

/** Whether older builds left entries or records here that never moved. */
async function holdsLegacy(): Promise<boolean> {
  const conn = await openExisting(DB.inputs);
  if (!conn) return false;
  conn.close();
  const [entries = 0, records = 0] = await countRecords([LIBRARY, JOBS]).catch(() => [0, 0]);
  return entries + records > 0;
}

async function perform(record: ResetRecord): Promise<void> {
  store({ state: "running", rows: record.rows, notes: record.notes, at: Date.now() });
  const root = document.getElementById("root");
  if (root) root.textContent = RESETTING_LINE;

  const notes = new Set<ResetNote>(record.notes);
  const plan = planReset(MANIFEST, record.rows, await holdsLegacy());
  // read before the legacy records go: an emptied document must not import them again
  const marks = emptiesDocument(plan) ? await legacyMarks() : null;

  for (const key of plan.remove) removeLocal(key);
  for (const rewrite of plan.rewrite) {
    const raw = readLocal(rewrite.key);
    if (raw === null) continue;
    const kept = rewriteRecord(raw, rewrite);
    if (kept === null) removeLocal(rewrite.key);
    else writeLocal(rewrite.key, kept);
  }
  if (plan.full) {
    removeLocalKeys(localKeys().filter((k) => k.startsWith(LOCAL_PREFIX) && k !== LOCAL.reset));
  }

  if (plan.inputs) {
    const done = await resetInputs(plan.inputs.clear, plan.inputs.meta, marks).catch(
      (err: unknown) => {
        console.error("[profile] the inputs could not be cleared", err);
        return false;
      },
    );
    if (!done) notes.add("newer");
  }
  for (const { db, store: name, keys } of plan.records) {
    await deleteRecords(db, name, keys).catch((err: unknown) => {
      console.error(`[profile] records of ${db} could not be deleted`, err);
      notes.add("blocked");
    });
  }
  const databases = [...plan.databases, ...(plan.full ? await strayDatabases() : [])];
  const deleted = await Promise.all(databases.map(deleteDatabase));
  if (deleted.includes("blocked")) notes.add("blocked");

  store({ state: "done", rows: record.rows, notes: [...notes], at: Date.now(), postponed: false });
  announceDone();
}

/** Carry out the record only if it is still the one read: another tab may
 * have done it meanwhile. */
async function performIfStill(seen: ResetRecord): Promise<void> {
  const now = current();
  if (!now || now.state === "done" || now.at !== seen.at) return;
  await perform(now);
}

/** A reset asked for on the last page, or left half done by a page that
 * closed, is finished before the app starts. Another tab of this origin that
 * holds its inputs postpones it. */
async function finishReset(): Promise<void> {
  for (;;) {
    const record = current();
    if (!record || record.state === "done") return;
    const result = await withInputsBarrier(() => performIfStill(record), BARRIER_WAIT_MS);
    if (result.kind === "ran") return;
    if (result.kind === "unlocked") {
      // without Web Locks a fresh running record is another tab's at work
      if (record.state === "running" && !isStale(record, Date.now())) {
        await sleep(POLL_MS);
        continue;
      }
      await performIfStill(record);
      return;
    }
    const now = current();
    if (now?.state === "running") {
      await sleep(POLL_MS);
      continue;
    }
    if (now?.state === "pending") {
      store({ state: "done", rows: now.rows, notes: now.notes, at: Date.now(), postponed: true });
    }
    return;
  }
}

export async function bootProfile(): Promise<void> {
  try {
    await finishReset();
  } catch (err) {
    console.error("[profile] the reset could not be finished", err);
  }
  startProfile();
  // held for the page's life from before any store exists, so another tab's
  // reset counts this one from its first moment
  void enterTab();
  listenForResets();
}
