import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Standalone: vite.config.ts probes for a running backend, which a test run
// has no business doing.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
