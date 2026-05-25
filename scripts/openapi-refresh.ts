/**
 * Refresh `src/api/types/openapi.snapshot.json` from the live SD.Next backend.
 *
 * Run with `npm run codegen:refresh` after changing any Pydantic model in
 * `enso_api/`. The script:
 * 1. Resolves the backend port via {@link detectBackendPort}.
 * 2. Fetches `/openapi.json`.
 * 3. Filters to `/sdapi/v2/*` paths, prunes unreferenced schemas, sorts keys.
 * 4. Writes the snapshot if it changed (no-op if identical).
 *
 * The snapshot IS committed to the repo. The downstream `vite/codegen-openapi.ts`
 * step regenerates `src/lib/openapi-generated/` (gitignored) on every dev/build.
 */

import fs from "fs";
import path from "path";
import { buildSnapshot, fetchOpenApi, serializeSnapshot } from "./openapi-shared.ts";

const SNAPSHOT_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  "..",
  "src",
  "api",
  "types",
  "openapi.snapshot.json",
);

async function main() {
  let raw;
  try {
    raw = await fetchOpenApi(process.env.BACKEND_PORT);
  } catch (error) {
    process.stderr.write(
      `codegen:refresh failed - backend not reachable.\n  ${(error as Error).message}\n  Start sdnext (e.g. webui.sh --enso) and retry.\n`,
    );
    process.exit(1);
  }

  const snapshot = buildSnapshot(raw);
  const next = serializeSnapshot(snapshot);

  let previous = "";
  try {
    previous = fs.readFileSync(SNAPSHOT_PATH, "utf-8");
  } catch {
    /* first run */
  }

  if (previous === next) {
    process.stdout.write(
      `codegen:refresh - snapshot unchanged (${next.length.toLocaleString()} bytes).\n`,
    );
    return;
  }

  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, next, "utf-8");

  const verb = previous ? "updated" : "created";
  const pathCount = Object.keys(snapshot.paths as Record<string, unknown>).length;
  const schemaCount = Object.keys(
    (snapshot.components as { schemas: Record<string, unknown> }).schemas,
  ).length;
  process.stdout.write(
    `codegen:refresh - ${verb} ${SNAPSHOT_PATH} (${pathCount} paths, ${schemaCount} schemas).\n`,
  );
}

await main();
