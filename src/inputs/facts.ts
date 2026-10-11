// What a card knows of a job: the server's record of it, or an older build's
// record while that waits to be moved, and whether this browser sent it.

import { recordItem } from "@/api/records";
import type { ItemRecordV2 } from "@/api/types/media";
import type { StoredJob } from "@/lib/inputs/stored";
import type { JobFacts } from "@/lib/jobs/cardActions";
import { asJobDomain } from "@/lib/jobs/domains";
import { refsIn } from "@/lib/jobs/replay";
import { clientId } from "./client";
import { legacyJob } from "./legacyRecords";

export function itemFacts(item: ItemRecordV2, client: string): JobFacts | null {
  const domain = asJobDomain(item.domain);
  return (
    domain && {
      domain,
      mine: item.client === client,
      routed: item.routed,
      hasInputs: item.has_inputs,
      missingRefs: item.missing_refs,
      lost: item.lost,
      unavailable: item.unavailable,
    }
  );
}

/** A job's facts; null when neither the server nor an older build keeps a record. */
export async function loadFacts(
  id: string,
  legacyOf: (id: string) => Promise<StoredJob | null> = legacyJob,
): Promise<JobFacts | null> {
  const [item, client] = await Promise.all([recordItem(id), clientId()]);
  if (item) return itemFacts(item, client);
  const legacy = await legacyOf(id);
  if (!legacy) return null;
  // its uploads may all be gone from the server: Run again makes them again
  return {
    domain: legacy.domain,
    mine: true,
    routed: legacy.routed,
    hasInputs: legacy.inputs !== null,
    missingRefs: refsIn(legacy.request).length,
    lost: 0,
    unavailable: 0,
  };
}
