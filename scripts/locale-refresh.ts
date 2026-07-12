/**
 * Refresh `src/data/locale_en.snapshot.json` from the live SD.Next backend.
 *
 * Run with `pnpm run locale:refresh` after SD.Next changes its hints (the
 * `docs(i18n)` / `docs(locale)` commit stream in `ui/locale/locale_en.json`).
 * The script:
 * 1. Resolves the backend port via {@link detectBackendPort}.
 * 2. Fetches `/file=ui/locale/locale_en.json`.
 * 3. Writes the snapshot if it changed (no-op if identical).
 *
 * The snapshot IS committed. The downstream `vite/codegen-locale.ts` step
 * regenerates `src/lib/localeHints.generated.ts` (gitignored) on every
 * dev/build, and `parameterHelp.ts` overlays Enso's divergences on top of it.
 */

import fs from "fs";
import path from "path";
import { countHints, fetchLocale } from "./locale-shared.ts";

const SNAPSHOT_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  "..",
  "src",
  "data",
  "locale_en.snapshot.json",
);

async function main() {
  let next;
  try {
    next = await fetchLocale(process.env.BACKEND_PORT);
  } catch (error) {
    process.stderr.write(
      `locale:refresh failed - backend not reachable.\n  ${(error as Error).message}\n  Start sdnext (e.g. webui.sh --enso) and retry.\n`,
    );
    process.exit(1);
  }

  let previous = "";
  try {
    previous = fs.readFileSync(SNAPSHOT_PATH, "utf-8");
  } catch {
    /* first run */
  }

  if (previous === next) {
    process.stdout.write(
      `locale:refresh - snapshot unchanged (${next.length.toLocaleString()} bytes).\n`,
    );
    return;
  }

  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, next, "utf-8");

  const verb = previous ? "updated" : "created";
  process.stdout.write(`locale:refresh - ${verb} ${SNAPSHOT_PATH} (${countHints(next)} hints).\n`);
}

await main();
