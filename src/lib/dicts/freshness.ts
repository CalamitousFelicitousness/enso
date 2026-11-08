// When a cached dictionary must be fetched again.

/** How long a copy is trusted when the server names no revision. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** What the server lists for a dictionary: its revision (`exact`), or on a
 * server without one, the version written inside the file. */
export interface Listed {
  key: string;
  exact: boolean;
}

/** Whether the copy cached under `key` at `cachedAt` must be fetched again:
 * the server serves another revision, or names none and the copy is a day
 * old. Without a listing only the age counts. */
export function outdated(
  cached: { key: string; cachedAt: number },
  listed: Listed | undefined,
  now: number,
): boolean {
  const aged = now - cached.cachedAt > MAX_AGE_MS;
  if (!listed) return aged;
  return cached.key !== listed.key || (!listed.exact && aged);
}
