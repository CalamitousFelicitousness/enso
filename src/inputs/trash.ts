// What user actions took out of the inputs, kept in the trash store of
// enso-inputs for the days the user set: a record names its pictures by cid
// like any document, so the sweep keeps their bytes, and drops the record
// and its bytes together once it has expired. The library's trashed entries
// are listed beside the removals.

import { toast } from "sonner";
import { create } from "zustand";
import { newId } from "@/lib/id";
import { inputsReady, settleInputs } from "@/stores/inputStore";
import { TRASH } from "@/lib/inputs/storeLayout";
import {
  joinRemoval,
  readRemoval,
  splitRemoval,
  type JoinLoss,
  type Removal,
  type StoredRemoval,
} from "@/lib/inputs/stored";
import { TRASH_DAYS } from "@/lib/inputs/sweep";
import {
  DELETE_FROM_TRASH_FAILED,
  deletedFromTrashText,
  FULL_WITH_OTHER_TABS,
  reclaimedText,
} from "@/lib/inputs/text";
import type { TrashItem } from "@/lib/inputs/trash";
import {
  deleteDocument,
  deleteForGood,
  readAllRecords,
  readDocument,
  readTrashDays,
  reclaimableBytes,
  writeDocument,
  type Reclaimed,
} from "./db";
import { aboutSize, serverFreedText } from "@/lib/media/text";
import { deleteEntry, emptyServerTrash } from "./library";
import { liveCids } from "./live";
import { failureText, isQuotaError, spaceFreed } from "./quota";
import { forgetThumbs } from "./thumbs";

interface TrashState {
  /** Removal records this build can read, by key. */
  removals: ReadonlyMap<string, StoredRemoval>;
  /** Keys of removal records this build cannot read. */
  unreadable: readonly string[];
  /** How many days the trash keeps what goes to it. */
  days: number;
  /** Items being restored, kept out of the list until their Undo settles. */
  restoring: ReadonlySet<string>;
  /** The bytes emptying the trash would free; null until measured. */
  reclaimable: number | null;
  /** The storage notice asked for the Empty dialog. */
  askEmpty: boolean;
  loaded: boolean;
}

export const useTrash = create<TrashState>()(() => ({
  removals: new Map(),
  unreadable: [],
  days: TRASH_DAYS.fallback,
  restoring: new Set(),
  reclaimable: null,
  askEmpty: false,
  loaded: false,
}));

/** This tab's own change to the trash, into what it lists. */
function listed(key: string, record: StoredRemoval | null): void {
  useTrash.setState((s) => {
    const removals = new Map(s.removals);
    if (record) removals.set(key, record);
    else removals.delete(key);
    return { removals };
  });
}

/** Store a removal under a new key and return it. */
export async function recordRemoval(removal: Removal): Promise<string> {
  const key = newId();
  const { record, blobs } = splitRemoval(removal);
  // a record this build could not read back would stop every sweep
  joinRemoval(readRemoval(record).record, blobs);
  await writeDocument(TRASH, key, record, blobs, 1);
  listed(key, record);
  return key;
}

/** Drop a record whose content is back in the inputs. */
export function forgetRemoval(key: string): Promise<void> {
  return deleteDocument(TRASH, key).then(
    () => listed(key, null),
    (err: unknown) => {
      console.error("[inputs] could not delete a removal record", err);
    },
  );
}

/** A removal with its bytes; null when the record is gone. */
export async function loadRemoval(
  key: string,
): Promise<{ removal: Removal; lost: JoinLoss } | null> {
  const stored = await readDocument(TRASH, key, readRemoval, (read) => read.cids);
  return stored ? joinRemoval(stored.document.record, stored.blobs) : null;
}

let reading: Promise<void> | null = null;

/** Read the trash and the days it keeps things, once the page-start sweep
 * has run, and again whenever another tab may have changed them. */
export function loadTrash(): Promise<void> {
  reading ??= (async () => {
    await inputsReady();
    try {
      const removals = new Map<string, StoredRemoval>();
      const unreadable: string[] = [];
      for (const [key, value] of await readAllRecords(TRASH)) {
        if (typeof key !== "string") continue;
        try {
          removals.set(key, readRemoval(value).record);
        } catch (err) {
          console.warn("[inputs] a removal record could not be read", key, err);
          unreadable.push(key);
        }
      }
      useTrash.setState({ removals, unreadable, days: await readTrashDays(), loaded: true });
    } catch (err) {
      console.error("[inputs] could not read the trash", err);
    }
  })().finally(() => {
    reading = null;
  });
  return reading;
}

/** Measure what emptying the trash would free, for the screen and the notice. */
export async function measureTrash(): Promise<number | null> {
  try {
    // a removal's picture stays named by the stored document until its debounced save
    await settleInputs();
    const bytes = await reclaimableBytes();
    useTrash.setState({ reclaimable: bytes });
    return bytes;
  } catch (err) {
    console.error("[inputs] could not measure the trash", err);
    return null;
  }
}

/** Keep an item out of the list while its restore can still be undone. */
export function markRestoring(id: string, on: boolean): void {
  useTrash.setState((s) => {
    const restoring = new Set(s.restoring);
    if (on) restoring.add(id);
    else restoring.delete(id);
    return { restoring };
  });
}

/** Delete records for good, freeing their bytes now when this is the only
 * Enso tab and at the next start in one tab otherwise, and say so under
 * `title`. False when nothing was deleted. */
async function deleteAndTell(
  targets: readonly { store: string; key: string }[],
  title: string,
  failedTitle: string,
): Promise<boolean> {
  let outcome: Reclaimed;
  try {
    await settleInputs();
    outcome = await deleteForGood(targets, liveCids);
  } catch (err) {
    console.error("[inputs] could not delete for good", err);
    // only a deletion beside other tabs writes, so only it meets a full disk
    toast.error(failedTitle, {
      description: isQuotaError(err) ? FULL_WITH_OTHER_TABS : failureText(err),
    });
    return false;
  }
  const freed = "freed" in outcome ? outcome.freed : null;
  if ("cids" in outcome) forgetThumbs(outcome.cids);
  if (freed !== null && freed > 0) spaceFreed();
  toast(title, { description: reclaimedText(freed) });
  return true;
}

/** Delete one item from the trash for good: a removal here, or a saved entry
 * for everyone. An older build's entry waits to be moved first. */
export async function deleteNow(item: Pick<TrashItem, "source" | "key">): Promise<void> {
  if (item.source === "entry") {
    await deleteEntry(item.key);
    return;
  }
  if (item.source !== "removal") return;
  const deleted = await deleteAndTell(
    [{ store: TRASH, key: item.key }],
    deletedFromTrashText(1),
    DELETE_FROM_TRASH_FAILED,
  );
  if (deleted) await loadTrash();
}

/** Empty the trash as it was listed: the removals here, freed now when this
 * is the only Enso tab, and the saved entries for everyone. One notice says
 * what each part freed. */
export async function emptyTrash(
  removals: readonly string[],
  entries: readonly string[],
  serverReclaimable: number | null,
): Promise<void> {
  const parts: string[] = [];
  if (removals.length > 0) {
    try {
      await settleInputs();
      const outcome = await deleteForGood(
        removals.map((key) => ({ store: TRASH, key })),
        liveCids,
      );
      const freed = "freed" in outcome ? outcome.freed : null;
      if ("cids" in outcome) forgetThumbs(outcome.cids);
      if (freed !== null && freed > 0) spaceFreed();
      parts.push(
        entries.length > 0 && freed !== null && freed > 0
          ? `${aboutSize(freed)} freed here`
          : reclaimedText(freed),
      );
    } catch (err) {
      console.error("[inputs] could not empty the trash", err);
      toast.error(DELETE_FROM_TRASH_FAILED, {
        description: isQuotaError(err) ? FULL_WITH_OTHER_TABS : failureText(err),
      });
    }
    await loadTrash();
  }
  if (entries.length > 0) {
    const server = await emptyServerTrash(entries);
    if (server) parts.push(serverFreedText(server.freed, serverReclaimable));
  }
  if (parts.length > 0) {
    toast(deletedFromTrashText(removals.length + entries.length), {
      description: parts.join(". "),
    });
  }
}
