import path from "node:path";
import type { Plugin } from "vite";
import { runCodegen } from "./codegen-locale.ts";

/**
 * Regenerates `src/lib/localeHints.generated.ts` on every dev/build start and
 * whenever `src/data/locale_en.snapshot.json` is touched during HMR.
 *
 * Sibling to {@link openapiCodegenPlugin}; same execution model.
 */
export function localeCodegenPlugin(): Plugin {
  const snapshotPath = path.resolve(process.cwd(), "src/data/locale_en.snapshot.json");
  let lastError: unknown = null;

  function regenerate(reason: string) {
    try {
      runCodegen();
      lastError = null;
      console.log(`[locale codegen] regenerated - ${reason}`);
    } catch (err) {
      lastError = err;
      console.error(`[locale codegen] failed: ${(err as Error).message}`);
    }
  }

  return {
    name: "enso:locale-codegen",
    apply: () => true,
    buildStart() {
      regenerate("buildStart");
      if (lastError) {
        if (lastError instanceof Error) throw lastError;
        throw new Error(typeof lastError === "string" ? lastError : "locale codegen failed");
      }
    },
    handleHotUpdate(ctx) {
      if (path.resolve(ctx.file) !== snapshotPath) return;
      regenerate(`hot update: ${path.relative(process.cwd(), ctx.file)}`);
      return undefined;
    },
  };
}
