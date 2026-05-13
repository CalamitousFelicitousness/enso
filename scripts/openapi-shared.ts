/**
 * Shared filter/sort logic between `openapi-refresh.ts` and `openapi-check.ts`.
 *
 * The host FastAPI app (Gradio-mounted) serves `/openapi.json` covering
 * `/sdapi/v1/*`, `/sdapi/v2/*`, and Gradio's own internal routes. Enso only
 * consumes `/sdapi/v2/*`, so we:
 *
 * 1. Filter `paths` to `/sdapi/v2/*` only.
 * 2. Walk those paths transitively collecting every referenced `$ref` into
 * `components.schemas` and drop schemas that aren't reachable from v2.
 * 3. Sort every object's keys deterministically so the JSON serialization
 * produces minimal diffs across regenerations.
 *
 * The output is committed to `src/api/types/openapi.snapshot.json`. The
 * codegen reads it; the drift-check compares freshly-fetched output against
 * it byte-for-byte.
 */

import { detectBackendPort } from "../vite/backend-port.ts";

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}

const SCHEMA_REF_PREFIX = "#/components/schemas/";

export async function fetchOpenApi(envPort?: string): Promise<JsonObject> {
  const port = await detectBackendPort(envPort);
  const url = `http://localhost:${port}/openapi.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as JsonObject;
}

function collectRefs(node: JsonValue, into: Set<string>): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, into);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref" && typeof value === "string" && value.startsWith(SCHEMA_REF_PREFIX)) {
      into.add(value.slice(SCHEMA_REF_PREFIX.length));
    } else {
      collectRefs(value, into);
    }
  }
}

/**
 * Walk schemas transitively: any schema referenced by a kept schema is also kept.
 * Idempotent - fixed-point iteration until no new schemas are reached.
 */
function expandReachableSchemas(allSchemas: JsonObject, seedNames: Set<string>): Set<string> {
  const reachable = new Set(seedNames);
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of [...reachable]) {
      const schema = allSchemas[name];
      if (!schema) continue;
      const refs = new Set<string>();
      collectRefs(schema, refs);
      for (const ref of refs) {
        if (!reachable.has(ref) && allSchemas[ref] !== undefined) {
          reachable.add(ref);
          changed = true;
        }
      }
    }
  }
  return reachable;
}

function sortKeys(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const sorted: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeys(value[key]);
  }
  return sorted;
}

/**
 * Produce the snapshot shape from a raw `/openapi.json` document. Filters
 * paths to `/sdapi/v2/*`, prunes unreferenced schemas, sorts keys.
 */
export function buildSnapshot(raw: JsonObject): JsonObject {
  const paths = (raw.paths as JsonObject | undefined) ?? {};
  const componentsRaw = (raw.components as JsonObject | undefined) ?? {};
  const allSchemas = (componentsRaw.schemas as JsonObject | undefined) ?? {};

  const keptPaths: JsonObject = {};
  for (const [pathKey, pathValue] of Object.entries(paths)) {
    if (pathKey.startsWith("/sdapi/v2/")) {
      keptPaths[pathKey] = pathValue;
    }
  }

  const seedRefs = new Set<string>();
  collectRefs(keptPaths, seedRefs);
  const reachable = expandReachableSchemas(allSchemas, seedRefs);

  const keptSchemas: JsonObject = {};
  for (const name of reachable) {
    if (allSchemas[name] !== undefined) keptSchemas[name] = allSchemas[name];
  }

  const snapshot: JsonObject = {
    openapi: raw.openapi ?? "3.1.0",
    info: raw.info ?? { title: "Enso V2 API", version: "0.0.0" },
    paths: keptPaths,
    components: { schemas: keptSchemas },
  };

  return sortKeys(snapshot) as JsonObject;
}

export function serializeSnapshot(snapshot: JsonObject): string {
  return JSON.stringify(snapshot, null, 2) + "\n";
}
