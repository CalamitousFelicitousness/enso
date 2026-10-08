// What user actions took out of the inputs, kept in the trash store of
// enso-inputs for the retention period: a record names its pictures by cid
// like any document, so the sweep keeps their bytes, and drops the record
// once it has expired.

import { deleteDocument, writeDocument } from "./db";
import { TRASH } from "@/lib/inputs/storeLayout";
import { joinRemoval, readRemoval, splitRemoval, type Removal } from "@/lib/inputs/stored";

/** Store a removal under a new key and return it. */
export async function recordRemoval(removal: Removal): Promise<string> {
  const key = crypto.randomUUID();
  const { record, blobs } = splitRemoval(removal);
  // a record this build could not read back would stop every sweep
  joinRemoval(readRemoval(record).record, blobs);
  await writeDocument(TRASH, key, record, blobs, 1);
  return key;
}

/** Drop a record whose content is back in the inputs. */
export function forgetRemoval(key: string): void {
  deleteDocument(TRASH, key).catch((err: unknown) => {
    console.error("[inputs] could not delete a removal record", err);
  });
}
