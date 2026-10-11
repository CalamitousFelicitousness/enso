// The record a job is posted with: the request's upload sources, the frames it
// was built from, and the hash on the server of every picture those frames
// and the sent maps name. A picture whose bytes did not get there is declared
// unavailable; a map that did not is left out, since the job can make it again.

import type { ReqRecordV2 } from "@/api/types/media";
import type { Source, StoredInputs, StoredJob } from "@/lib/inputs/stored";
import { refsIn } from "@/lib/jobs/replay";

export interface RecordParts {
  client: string;
  checkpoint: StoredJob["checkpoint"];
  /** The request as it is posted, its upload refs real. */
  request: object;
  /** Where each upload came from, by the ref it went out under. */
  refs: Readonly<Record<string, Source>>;
  inputs: StoredInputs | null;
  /** Every cid the inputs name. */
  inputCids: readonly string[];
  /** The maps the job makes before generating. */
  mapKeys: readonly string[];
  /** The cid of each map the job sent as a picture, by key. */
  maps: Readonly<Record<string, string>>;
  /** The hash of each cid's bytes on the server; a cid without one did not get there. */
  hashes: ReadonlyMap<string, string>;
}

export function assembleRecord(parts: RecordParts): ReqRecordV2 {
  const named = new Set(refsIn(parts.request));
  const refs = Object.fromEntries(Object.entries(parts.refs).filter(([ref]) => named.has(ref)));
  const hashes: Record<string, string> = {};
  const unavailable: string[] = [];
  for (const cid of new Set(parts.inputCids)) {
    const hash = parts.hashes.get(cid);
    if (hash) hashes[cid] = hash;
    else unavailable.push(cid);
  }
  const maps: Record<string, string> = {};
  const gone = new Set<string>();
  for (const [key, cid] of Object.entries(parts.maps)) {
    const hash = parts.hashes.get(cid);
    if (hash) {
      maps[key] = cid;
      hashes[cid] = hash;
    } else {
      gone.add(key);
    }
  }
  return {
    client: parts.client,
    checkpoint: parts.checkpoint ? { ...parts.checkpoint } : null,
    refs,
    inputs: parts.inputs
      ? (structuredClone(parts.inputs) as unknown as Record<string, unknown>)
      : null,
    map_keys: parts.mapKeys.filter((key) => !gone.has(key)),
    maps,
    hashes,
    unavailable,
  };
}
