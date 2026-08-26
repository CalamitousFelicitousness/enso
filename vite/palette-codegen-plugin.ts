import path from "node:path";
import type { Plugin } from "vite";
import { runCodegen } from "./codegen-paramMap.ts";
import { isParamSourceFile } from "./param-sources.ts";

export function paletteCodegenPlugin(): Plugin {
  let lastError: unknown = null;

  function regenerate(reason: string) {
    try {
      const result = runCodegen();
      lastError = null;
      for (const w of result.warnings) {
        console.warn(
          `[paramMap codegen] ${path.relative(process.cwd(), w.file)}:${w.line} ${w.message}`,
        );
      }
      if (result.changed) {
        console.log(`[paramMap codegen] regenerated (${result.params.length} entries) - ${reason}`);
      }
    } catch (err) {
      lastError = err;
      console.error(`[paramMap codegen] failed: ${(err as Error).message}`);
    }
  }

  return {
    name: "enso:palette-codegen",
    apply: () => true,
    buildStart() {
      regenerate("buildStart");
      if (lastError) {
        if (lastError instanceof Error) throw lastError;
        throw new Error(typeof lastError === "string" ? lastError : "palette codegen failed");
      }
    },
    handleHotUpdate(ctx) {
      if (!isParamSourceFile(process.cwd(), ctx.file)) return;
      regenerate(`hot update: ${path.relative(process.cwd(), ctx.file)}`);
      return undefined;
    },
  };
}
