/** A persisted store that could not read or write its record. */
export type StorageProblem =
  | {
      kind: "read";
      /** Stable per store, so a repeat replaces the earlier notice. */
      id: string;
      /** What the record holds, as the user knows it ("canvas inputs"). */
      what: string;
      /** A newer version of the app wrote the record. */
      newer?: boolean;
      retry: () => void;
      startEmpty: () => void;
    }
  | {
      kind: "write";
      id: string;
      what: string;
      /** Why, when it is not the browser refusing: said in place of the usual hint. */
      reason?: string;
    }
  | {
      /** Another tab stored a newer version; this tab's writes are refused. */
      kind: "conflict";
      id: string;
      what: string;
      /** Load what the other tab stored, dropping this tab's unsaved changes. */
      useStored: () => void;
      /** Store this tab's version over the other tab's. */
      keepMine: () => void;
    }
  | { kind: "resolved"; id: string };

type Listener = (problem: StorageProblem) => void;

const listeners = new Set<Listener>();
// Stores hydrate at module load, before anything can listen.
const backlog: StorageProblem[] = [];

export function reportStorageProblem(problem: StorageProblem): void {
  if (listeners.size === 0) backlog.push(problem);
  for (const listener of listeners) listener(problem);
}

export function onStorageProblem(listener: Listener): () => void {
  listeners.add(listener);
  for (const problem of backlog.splice(0)) listener(problem);
  return () => {
    listeners.delete(listener);
  };
}
