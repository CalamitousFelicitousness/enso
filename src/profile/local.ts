// The one door to this browser's localStorage. The stores that keep their
// state there persist through persistLocal; every other key goes through
// readLocal and writeLocal. A browser that refuses a write is said so once,
// as the other stores' failures are.

import type { StateCreator, StoreMutatorIdentifier } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
  type PersistStorage,
  type StateStorage,
} from "zustand/middleware";
import type { LocalKey } from "@/lib/profile/names";
import { reportStorageProblem } from "@/lib/storageHealth";

const PROBLEM_ID = "local-storage";
const WHAT = "settings";
const BLOCKED = "This browser does not let Enso keep them.";

let failing = false;

/** The storage as it is now; null where the browser has none or refuses it. */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function refused(blocked: boolean): void {
  if (failing) return;
  failing = true;
  reportStorageProblem({
    kind: "write",
    id: PROBLEM_ID,
    what: WHAT,
    ...(blocked && { reason: BLOCKED }),
  });
}

function stored(): void {
  if (!failing) return;
  failing = false;
  reportStorageProblem({ kind: "resolved", id: PROBLEM_ID });
}

function get(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function set(key: string, value: string): void {
  const local = storage();
  if (!local) {
    refused(true);
    return;
  }
  try {
    local.setItem(key, value);
    stored();
  } catch {
    refused(false);
  }
}

function remove(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // nothing kept to lose
  }
}

export function readLocal(key: LocalKey): string | null {
  return get(key);
}

export function writeLocal(key: LocalKey, value: string): void {
  set(key, value);
}

export function removeLocal(key: LocalKey): void {
  remove(key);
}

/** Every key this origin's localStorage holds, Enso's or not. */
export function localKeys(): string[] {
  const local = storage();
  if (!local) return [];
  try {
    return Array.from({ length: local.length }, (_, i) => local.key(i)).filter(
      (key): key is string => key !== null,
    );
  } catch {
    return [];
  }
}

const stateStorage: StateStorage = { getItem: get, setItem: set, removeItem: remove };

const json = createJSONStorage(() => stateStorage);

type Mutators = [StoreMutatorIdentifier, unknown][];

/** zustand's persist for a store kept in localStorage, under a name the
 * manifest knows. The storage is added after inference: passed alongside the
 * options, it would widen the persisted state to unknown. */
export function persistLocal<T, Mps extends Mutators = [], Mcs extends Mutators = [], U = T>(
  initializer: StateCreator<T, [...Mps, ["zustand/persist", unknown]], Mcs>,
  options: Omit<PersistOptions<T, U>, "storage" | "name"> & { name: LocalKey },
): StateCreator<T, Mps, [["zustand/persist", U], ...Mcs]> {
  return persist(initializer, { ...options, storage: json as PersistStorage<U> });
}
