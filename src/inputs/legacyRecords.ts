// What older builds kept of jobs in this browser, read while it waits to be
// moved to the server: a card, a restore, Run again and a page start find in
// it a job the server has no record of. Nothing here writes but the routed
// mark, which keeps a page start from routing a job twice.

import { readJob, type ReadJob, type StoredJob } from "@/lib/inputs/stored";
import { JOBS } from "@/lib/inputs/storeLayout";
import { stripDomain } from "@/lib/jobs/domains";
import { readAllRecords, readDocument, updateRecord } from "./db";

/** An older build's record of a job, with the bytes of the cids `need` names;
 * null when there is none or it cannot be read. */
export async function legacyJobWithBytes(
  id: string,
  need: (record: StoredJob) => string[],
): Promise<{ record: StoredJob; blobs: Map<string, Blob> } | null> {
  try {
    const stored = await readDocument<ReadJob>(JOBS, id, readJob, (read) => need(read.record));
    return stored && { record: stored.document.record, blobs: stored.blobs };
  } catch (err) {
    console.warn("[inputs] an older build's job record could not be read", id, err);
    return null;
  }
}

/** An older build's record of a job, without bytes. */
export async function legacyJob(id: string): Promise<StoredJob | null> {
  return (await legacyJobWithBytes(id, () => []))?.record ?? null;
}

/** The older builds' records of strip jobs whose results have not arrived. */
export async function legacyUnrouted(): Promise<StoredJob[]> {
  const records: StoredJob[] = [];
  try {
    for (const [, value] of await readAllRecords(JOBS)) {
      try {
        const { record } = readJob(value);
        if (!record.routed && stripDomain(record.domain)) records.push(record);
      } catch {
        // a record this build cannot read is left as it is
      }
    }
  } catch (err) {
    console.warn("[inputs] the job records of older builds could not be read", err);
  }
  return records;
}

/** Mark an older build's record routed; nothing is written for one that is
 * gone or unreadable. */
export async function markLegacyRouted(id: string): Promise<void> {
  await updateRecord(JOBS, id, (raw) => {
    const { record } = readJob(raw);
    return record.routed ? null : readJob({ ...record, routed: true }).record;
  });
}
