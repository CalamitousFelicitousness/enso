// How many results the Images strip keeps, and the arithmetic of keeping them.

export const STRIP_LIMIT_MIN = 1;
export const STRIP_LIMIT_MAX = 100;
export const STRIP_LIMIT_DEFAULT = 16;

/** A limit as stored: a value no strip can use takes the default. */
export function clampStripLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < STRIP_LIMIT_MIN) {
    return STRIP_LIMIT_DEFAULT;
  }
  return Math.min(STRIP_LIMIT_MAX, Math.round(value));
}

/** The generation settings as an older build persisted them. Version 3 and
 * before took the limit from sdnext's latent cache size, which may be 0. */
export function migrateGeneration(persisted: unknown): Record<string, unknown> {
  const state =
    typeof persisted === "object" && persisted !== null
      ? (persisted as Record<string, unknown>)
      : {};
  return { ...state, historyLimit: clampStripLimit(state["historyLimit"]) };
}

/** The newest `limit` results, and the rest. */
export function splitAtLimit<T>(results: readonly T[], limit: number): { kept: T[]; removed: T[] } {
  return { kept: results.slice(0, limit), removed: results.slice(limit) };
}

/** A result put in front of the list, replacing one with its id. */
export function withResult<T extends { id: string }>(results: readonly T[], result: T): T[] {
  return [result, ...results.filter((r) => r.id !== result.id)];
}
