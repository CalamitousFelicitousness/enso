// The frames a job was sent with, kept beside the working document so a
// result can bring its inputs back. A snapshot names its pictures by cid like
// any document, so results that share inputs share their bytes, and it is
// deleted with its result, never swept.

import { deleteDocument, readDocument, SNAPSHOTS, writeDocument } from "./db";
import {
  joinSnapshot,
  readSnapshot,
  splitSnapshot,
  type JoinLoss,
  type ReadSnapshot,
} from "@/lib/inputs/stored";
import { hasMask, type Frame, type Size } from "@/lib/inputs/types";
import type { JobSnapshot } from "@/stores/jobStore";

/** What the snapshots store's records name, for the sweep. */
export function snapshotCids(record: unknown): string[] {
  return readSnapshot(record).cids;
}

/** Store the frames under a new key and return it; undefined when they hold
 * nothing worth bringing back. */
export async function rememberInputs(frames: Frame[], size: Size): Promise<string | undefined> {
  const worthKeeping = frames.some(
    (f) => f.pictures.length > 0 || hasMask(f) || f.ipAdapter.masks.length > 0,
  );
  if (!worthKeeping) return undefined;
  const key = crypto.randomUUID();
  const { record, blobs } = splitSnapshot(frames, size);
  readSnapshot(record);
  await writeDocument(SNAPSHOTS, key, record, blobs, 1);
  return key;
}

export interface InputsSnapshot {
  frames: Frame[];
  size: Size;
  lost: JoinLoss;
}

/** The stored frames with their bytes, or null when the snapshot is gone. */
export async function readInputsSnapshot(key: string): Promise<InputsSnapshot | null> {
  const stored = await readDocument<ReadSnapshot>(
    SNAPSHOTS,
    key,
    readSnapshot,
    (read) => read.cids,
  );
  return stored ? joinSnapshot(stored.document.record, stored.blobs) : null;
}

export function forgetInputs(key: string): void {
  deleteDocument(SNAPSHOTS, key).catch((err: unknown) => {
    console.error("[inputs] could not delete a result's stored inputs", err);
  });
}

/** A job snapshot of its own for a job made from another job's snapshot, so
 * each result's inputs are deleted with that result alone. The record is
 * copied under a new key; the bytes it names are shared. */
export async function cloneJobInputs(snapshot: JobSnapshot): Promise<JobSnapshot> {
  if (snapshot.kind === "none" || snapshot.kind === "maps" || !snapshot.inputsKey) return snapshot;
  try {
    const stored = await readDocument<ReadSnapshot>(
      SNAPSHOTS,
      snapshot.inputsKey,
      readSnapshot,
      () => [],
    );
    if (!stored) return { ...snapshot, inputsKey: undefined };
    const key = crypto.randomUUID();
    await writeDocument(SNAPSHOTS, key, stored.document.record, new Map(), 1);
    return { ...snapshot, inputsKey: key };
  } catch (err) {
    console.error("[inputs] could not copy a job's stored inputs", err);
    return { ...snapshot, inputsKey: undefined };
  }
}
