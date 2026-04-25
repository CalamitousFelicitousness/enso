import path from "node:path";
import type { Plugin } from "vite";
import { runCodegen } from "./codegen-paramMap.ts";

export function paletteCodegenPlugin(): Plugin {
  const tabsDir = path.resolve(process.cwd(), "src/components/generation/tabs");
  let lastError: unknown = null;

  function regenerate(reason: string) {
    try {
      const result = runCodegen();
      lastError = null;
      for (const w of result.warnings) {
        console.warn(`[paramMap codegen] ${path.relative(process.cwd(), w.file)}:${w.line} ${w.message}`);
      }
      if (result.changed) {
        console.log(`[paramMap codegen] regenerated (${result.params.length} entries) — ${reason}`);
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
      if (lastError) throw lastError;
    },
    handleHotUpdate(ctx) {
      const isTabFile =
        ctx.file.startsWith(tabsDir) &&
        ctx.file.endsWith("Tab.tsx");
      if (!isTabFile) return;
      regenerate(`hot update: ${path.relative(process.cwd(), ctx.file)}`);
      return undefined;
    },
  };
}
