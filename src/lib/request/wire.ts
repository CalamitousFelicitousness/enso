import type { DetailerModelEntry, DetailerModelRef } from "@/api/types/v2";

/** Strip undefined-valued keys so the wire payload stays minimal.
 * Empty-string text fields are treated as "inherit" too - the V2 schema
 * uses absence to mean inheritance, and an empty override is meaningless. */
export function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (typeof v === "string" && v === "") continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/** Serialize a DetailerModelEntry. If only `name` is set, returns the
 * bare string shorthand so the backend doesn't need to unwrap an object. */
export function serializeDetailerEntry(entry: DetailerModelEntry): DetailerModelRef {
  const stripped = stripUndefined(entry);
  const keys = Object.keys(stripped);
  if (keys.length === 1 && keys[0] === "name" && stripped.name) return stripped.name;
  return stripped as DetailerModelEntry;
}
