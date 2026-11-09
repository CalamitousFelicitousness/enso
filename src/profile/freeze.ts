// A tab told that another tab is resetting this browser's storage stops
// writing to it and waits to reload. Set once, never cleared: the reload
// clears it.

let frozen = false;
const listeners = new Set<() => void>();

export function freezeProfile(): void {
  if (frozen) return;
  frozen = true;
  for (const listener of listeners) listener();
}

export function profileFrozen(): boolean {
  return frozen;
}

export function onFrozen(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What an opener answers while frozen: nothing, ever, so no database another
 * tab is deleting is opened again from here. */
export function neverOpen<T>(): Promise<T> {
  return new Promise<T>(() => {});
}
