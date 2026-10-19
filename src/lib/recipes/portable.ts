// What a recipe's request keeps, by the one list the server also reads
// (portable.json): kept fields travel, dropped fields stay behind, and a field
// naming pictures holds an upload ref by hash or nothing.

import type { JsonValue } from "@/lib/inputs/types";
import portable from "./portable.json";

const KEEP = new Set(portable.keep);
const DROP = new Set(portable.drop);
const HASH_REF = /^upload:[0-9a-f]{64}$/;

/** A field a user set that the recipe leaves behind, for the save's notice. */
export type LeftOut = "grading_lut_file" | "extra";

export interface PortableRequest {
  request: Record<string, JsonValue>;
  leftOut: LeftOut[];
  /** Fields neither list knows: the server refuses them. */
  unknown: string[];
  /** Picture fields holding something other than an upload ref, by path. */
  notRefs: string[];
}

/** The values at one ref field, `name[]` for each item of a list and `a[].b`
 * through a list of objects, with their paths. */
export function refValues(
  request: Record<string, JsonValue>,
  field: string,
): [string, JsonValue][] {
  let found: [string, JsonValue][] = [["", request]];
  for (const part of field.split(".")) {
    const many = part.endsWith("[]");
    const key = many ? part.slice(0, -2) : part;
    const step: [string, JsonValue][] = [];
    for (const [path, value] of found) {
      if (typeof value !== "object" || value === null || Array.isArray(value) || !(key in value))
        continue;
      const inner = value[key];
      const at = path ? `${path}.${key}` : key;
      if (!many) step.push([at, inner]);
      else if (Array.isArray(inner)) inner.forEach((item, i) => step.push([`${at}[${i}]`, item]));
    }
    found = step;
  }
  return found;
}

export function portableRequest(request: Record<string, JsonValue>): PortableRequest {
  const kept: Record<string, JsonValue> = {};
  const leftOut: LeftOut[] = [];
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(request)) {
    if (KEEP.has(key)) kept[key] = value;
    else if (key === "extra") {
      if (typeof value === "object" && value !== null && Object.keys(value).length > 0)
        leftOut.push("extra");
    } else if (!DROP.has(key)) unknown.push(key);
  }
  // A LUT the server holds as a file goes by its path, which another server does not have
  const lut = kept["grading_lut_file"];
  if (typeof lut === "string" && lut !== "" && !HASH_REF.test(lut)) {
    kept["grading_lut_file"] = "";
    leftOut.push("grading_lut_file");
  }
  const notRefs = portable.refs.flatMap((field) =>
    refValues(kept, field)
      .filter(
        ([, value]) =>
          !(value === null || value === "" || (typeof value === "string" && HASH_REF.test(value))),
      )
      .map(([path]) => path),
  );
  return { request: kept, leftOut, unknown, notRefs };
}
