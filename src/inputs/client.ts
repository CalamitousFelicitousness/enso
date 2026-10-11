// This browser's name on the server: the job records that carry it are this
// browser's own, so only their jobs are tracked and routed here. Kept in the
// inputs database and in localStorage, so clearing one keeps it.

import { newId } from "@/lib/id";
import { readMeta, writeMeta } from "./db";

const STORAGE_KEY = "enso-client";
const META_KEY = "client";

function fromStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function toStorage(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // a private window keeps it in the database alone
  }
}

let known: Promise<string> | null = null;

/** The id this browser profile sends its job records under, minted once. */
export function clientId(): Promise<string> {
  known ??= (async () => {
    const stored = await readMeta(META_KEY).catch(() => null);
    const id = (typeof stored === "string" && stored) || fromStorage() || newId();
    if (stored !== id) {
      await writeMeta(META_KEY, id).catch((err: unknown) => {
        console.warn("[inputs] could not keep this browser's client id", err);
      });
    }
    if (fromStorage() !== id) toStorage(id);
    return id;
  })();
  return known;
}
