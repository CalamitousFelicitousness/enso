// A blob's name on the media store: the SHA-256 of its bytes as 64 lowercase
// hex, the only form that goes into a blob's path or a claim.

const HASH = /^[0-9a-f]{64}$/;

export function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

/** The well-formed hash `hashes` holds for `cid` as its own key, else null. */
export function hashOf(hashes: Readonly<Record<string, unknown>>, cid: string): string | null {
  if (!Object.hasOwn(hashes, cid)) return null;
  const hash = hashes[cid];
  return isHash(hash) ? hash : null;
}
