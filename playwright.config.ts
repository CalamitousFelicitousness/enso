import { defineConfig } from "@playwright/test";

// Live suite: real generations on the running sdnext backend, one at a time.
// It never loads a model: each spec skips unless the loaded model has the
// capability it tests, so run it once per model family.
//
//   pnpm run test:e2e                          against the dev server
//   ENSO_URL=http://127.0.0.1:7855/enso/ ...   against the deployed build
//   SDNEXT_LOG=<sdnext.log> ...                also asserts on the server's pipeline calls
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "e2e/.results",
  use: {
    baseURL: process.env["ENSO_URL"] ?? "http://localhost:5174/enso/",
    channel: "chrome",
    viewport: { width: 1920, height: 1080 },
    actionTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
