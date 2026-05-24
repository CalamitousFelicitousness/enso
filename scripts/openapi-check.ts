/**
 * Drift check: fail if `src/api/types/openapi.snapshot.json` doesn't match
 * the live SD.Next backend's `/openapi.json`.
 *
 * Run with `npm run codegen:check`. Used by developers locally (and by CI
 * once a workflow exists) to catch the case where a Pydantic change shipped
 * without a corresponding `npm run codegen:refresh`.
 *
 * On drift, exits nonzero with a unified-diff hint pointing the developer
 * at the refresh command.
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

function firstDiffLine(
  a: string,
  b: string,
): { line: number; aLine: string; bLine: string } | null {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const limit = Math.min(aLines.length, bLines.length);
  for (let i = 0; i < limit; i++) {
    if (aLines[i] !== bLines[i]) {
      return { line: i + 1, aLine: aLines[i] ?? "", bLine: bLines[i] ?? "" };
    }
  }
  if (aLines.length !== bLines.length) {
    return { line: limit + 1, aLine: aLines[limit] ?? "", bLine: bLines[limit] ?? "" };
  }
  return null;
}

async function main() {
  let raw;
  try {
    raw = await fetchOpenApi(process.env.BACKEND_PORT);
  } catch (error) {
    process.stderr.write(
      `codegen:check failed - backend not reachable.\n  ${(error as Error).message}\n  Start sdnext (e.g. webui.sh --enso) and retry.\n`,
    );
    process.exit(1);
  }

  const liveSnapshot = serializeSnapshot(buildSnapshot(raw));

  let committed = "";
  try {
    committed = fs.readFileSync(SNAPSHOT_PATH, "utf-8");
  } catch {
    process.stderr.write(
      `codegen:check failed - snapshot file missing.\n  Expected: ${SNAPSHOT_PATH}\n  Run \`npm run codegen:refresh\` to create it.\n`,
    );
    process.exit(1);
  }

  if (committed === liveSnapshot) {
    process.stdout.write("codegen:check - snapshot matches live backend.\n");
    return;
  }

  const diff = firstDiffLine(committed, liveSnapshot);
  process.stderr.write("codegen:check - DRIFT detected.\n");
  if (diff) {
    process.stderr.write(`  First difference at line ${diff.line}:\n`);
    process.stderr.write(`    committed: ${diff.aLine.slice(0, 200)}\n`);
    process.stderr.write(`    live:      ${diff.bLine.slice(0, 200)}\n`);
  }
  process.stderr.write("\n  Run `npm run codegen:refresh` to update the snapshot, then commit.\n");
  process.exit(1);
}

await main();
