/**
 * Drift check: fail if `src/data/locale_en.snapshot.json` doesn't match the
 * live SD.Next backend's `/file=ui/locale/locale_en.json`.
 *
 * Run with `npm run locale:check`. Catches the case where SD.Next expanded its
 * hints without a corresponding `npm run locale:refresh` in Enso. On drift,
 * exits nonzero with a first-difference hint pointing at the refresh command.
 */

import fs from "fs";
import path from "path";
import { fetchLocale } from "./locale-shared.ts";

const SNAPSHOT_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  "..",
  "src",
  "data",
  "locale_en.snapshot.json",
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
  let live;
  try {
    live = await fetchLocale(process.env.BACKEND_PORT);
  } catch (error) {
    process.stderr.write(
      `locale:check failed - backend not reachable.\n  ${(error as Error).message}\n  Start sdnext (e.g. webui.sh --enso) and retry.\n`,
    );
    process.exit(1);
  }

  let committed = "";
  try {
    committed = fs.readFileSync(SNAPSHOT_PATH, "utf-8");
  } catch {
    process.stderr.write(
      `locale:check failed - snapshot file missing.\n  Expected: ${SNAPSHOT_PATH}\n  Run \`npm run locale:refresh\` to create it.\n`,
    );
    process.exit(1);
  }

  if (committed === live) {
    process.stdout.write("locale:check - snapshot matches live backend.\n");
    return;
  }

  const diff = firstDiffLine(committed, live);
  process.stderr.write("locale:check - DRIFT detected.\n");
  if (diff) {
    process.stderr.write(`  First difference at line ${diff.line}:\n`);
    process.stderr.write(`    committed: ${diff.aLine.slice(0, 200)}\n`);
    process.stderr.write(`    live:      ${diff.bLine.slice(0, 200)}\n`);
  }
  process.stderr.write("\n  Run `npm run locale:refresh` to update the snapshot, then commit.\n");
  process.exit(1);
}

await main();
