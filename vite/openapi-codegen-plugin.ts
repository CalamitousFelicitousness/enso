import path from "node:path";
import type { Plugin } from "vite";
import { runCodegen } from "./codegen-openapi.ts";

/**
 * Regenerates `src/lib/openapi-generated/` on every dev/build start and
 * whenever `src/api/types/openapi.snapshot.json` is touched during HMR.
 *
 * Sibling to {@link paletteCodegenPlugin}; same execution model.
 */
export function openapiCodegenPlugin(): Plugin {
  const snapshotPath = path.resolve(process.cwd(), "src/api/types/openapi.snapshot.json");
  let lastError: unknown = null;

  async function regenerate(reason: string) {
    try {
      await runCodegen();
      lastError = null;
      console.log(`[openapi codegen] regenerated — ${reason}`);
    } catch (err) {
      lastError = err;
      console.error(`[openapi codegen] failed: ${(err as Error).message}`);
    }
  }

  return {
    name: "enso:openapi-codegen",
    apply: () => true,
    async buildStart() {
      await regenerate("buildStart");
      if (lastError) {
        if (lastError instanceof Error) throw lastError;
        throw new Error(typeof lastError === "string" ? lastError : "openapi codegen failed");
      }
    },
    async handleHotUpdate(ctx) {
      if (path.resolve(ctx.file) !== snapshotPath) return;
      await regenerate(`hot update: ${path.relative(process.cwd(), ctx.file)}`);
      return undefined;
    },
  };
}
