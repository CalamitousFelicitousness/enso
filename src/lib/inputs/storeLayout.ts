// The stores of the enso-inputs database, and how the sweep reads each store
// of documents: the cids a record names, and when the record may be dropped.
// A document store without a reader stops every sweep.

import { readEntry, readJob, readMap, readRemoval, readSnapshot, readWorking } from "./stored";
import { mapExpiry, removalExpiry, type StoreReader } from "./sweep";

/** The working document. */
export const DOCUMENTS = "documents";
/** The frames a job was sent with, by the key its result carries. Written by
 * older builds; read, never written. */
export const SNAPSHOTS = "snapshots";
/** What user actions removed, kept until its record expires. */
export const TRASH = "trash";
/** The maps processors made, by map key, kept until a record expires. */
export const MAPS = "maps";
/** What this browser keeps of each job it sent, by the server's job id. */
export const JOBS = "jobs";
/** Saved frames and sets, by entry id. One in the trash expires like a removal. */
export const LIBRARY = "library";
/** Picture bytes by cid, written once. */
export const BLOBS = "blobs";
export const META = "meta";

export type DocumentStore =
  typeof DOCUMENTS | typeof SNAPSHOTS | typeof TRASH | typeof MAPS | typeof JOBS | typeof LIBRARY;

export const READERS: Readonly<Record<DocumentStore, StoreReader>> = {
  [DOCUMENTS]: (record) => ({ cids: readWorking(record).cids }),
  [SNAPSHOTS]: (record) => ({ cids: readSnapshot(record).cids }),
  [TRASH]: (record) => {
    const read = readRemoval(record);
    // what the user removed goes with its record; a map keeps the grace
    return {
      cids: read.cids,
      expiresAt: removalExpiry(read.record.removedAt),
      inTrash: true,
    };
  },
  [MAPS]: (record) => {
    const read = readMap(record);
    return { cids: read.cids, expiresAt: mapExpiry(read.record.usedAt) };
  },
  [JOBS]: (record) => ({ cids: readJob(record).cids }),
  [LIBRARY]: (record) => {
    const read = readEntry(record);
    const { trashedAt } = read.record;
    return trashedAt === null
      ? { cids: read.cids }
      : { cids: read.cids, expiresAt: removalExpiry(trashedAt), inTrash: true };
  },
};

/** Every store the database has. */
export const STORES: readonly string[] = [...Object.keys(READERS), BLOBS, META];

/** The jobs store's index of records by when they were created. */
export const JOBS_BY_CREATION = "createdAt";
