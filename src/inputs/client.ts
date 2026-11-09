// This browser's name on the server: the job records that carry it are this
// browser's own, so only their jobs are tracked and routed here. Kept in the
// inputs database and in localStorage, so clearing one keeps it.

import { newId } from "@/lib/id";
import { META_KEY } from "@/lib/inputs/metaKeys";
import { LOCAL } from "@/lib/profile/names";
import { readLocal, writeLocal } from "@/profile/local";
import { readMeta, writeMeta } from "./db";

let known: Promise<string> | null = null;

/** The id this browser profile sends its job records under, minted once. */
export function clientId(): Promise<string> {
  known ??= (async () => {
    const stored = await readMeta(META_KEY.client).catch(() => null);
    const id = (typeof stored === "string" && stored) || readLocal(LOCAL.client) || newId();
    if (stored !== id) {
      await writeMeta(META_KEY.client, id).catch((err: unknown) => {
        console.warn("[inputs] could not keep this browser's client id", err);
      });
    }
    if (readLocal(LOCAL.client) !== id) writeLocal(LOCAL.client, id);
    return id;
  })();
  return known;
}
