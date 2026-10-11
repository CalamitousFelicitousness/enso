import { expect, test } from "@playwright/test";
import { Enso, PORTRAIT } from "./support/app";
import { imageSizes, jobLog, loadedCheckpoint, pipelineCalls, type Job } from "./support/backend";

// The record a job leaves: running it again sends the request it was sent
// with, its pictures under the same refs, since the server names bytes by
// their hash; restoring its result brings back its seed and its inputs. Needs
// the model the edit-model spec needs, at the same sizes.
const BASE = { width: 704, height: 1280 };
const EDIT = "Change the neon sign color from pink to bright green. Keep everything else the same.";

test.beforeEach(async ({ request }) => {
  const checkpoint = await loadedCheckpoint(request);
  test.skip(
    !checkpoint.loaded || checkpoint.request_sets_size !== true,
    `needs a loaded edit model that sizes its output from the request (loaded: ${checkpoint.name ?? "none"})`,
  );
});

async function prepare(app: Enso): Promise<void> {
  await app.open();
  await app.addReferences(PORTRAIT);
  await app.setPrompt(EDIT);
  await app.setSize(BASE.width, BASE.height);
  // The first-run sampler is Euler, which flow-match models reject
  await app.setSampler("Euler", "Default");
  await app.setSteps(8);
}

const isRef = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("upload:");

/** Every upload ref a request names, however deep. */
function refsOf(value: unknown): string[] {
  if (isRef(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(refsOf);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(refsOf);
  return [];
}

/** The request with every upload ref replaced by one mark. */
function masked(value: unknown): unknown {
  if (isRef(value)) return "upload:*";
  if (Array.isArray(value)) return value.map(masked);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, masked(v)]));
  }
  return value;
}

test("running a job again sends the same request with the same refs and no upload", async ({
  page,
}) => {
  const app = new Enso(page);
  await prepare(app);
  const first: Job = await app.generate();
  expect(first.error ?? null).toBeNull();

  // Changed in the UI between the runs: Run again sends what the job was sent with
  await app.setPrompt("A different prompt that must not be sent");
  await app.setSteps(12);
  // the server holds every picture the job sent, so nothing goes up again
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/sdapi/v2/blobs") {
      uploads.push(request.url());
    }
  });
  const second = await app.runAgain();
  expect(second.error ?? null).toBeNull();
  expect(uploads, "uploads during Run again").toEqual([]);
  expect(imageSizes(second)).toEqual(["704x1280"]);

  const sent = first.result?.params ?? {};
  const again = second.result?.params ?? {};
  expect(masked(again)).toEqual(masked(sent));
  const before = [...new Set(refsOf(sent))].sort();
  const after = [...new Set(refsOf(again))].sort();
  expect(before.length).toBeGreaterThan(0);
  expect(after).toEqual(before);
  const log = jobLog(second.id);
  if (log) expect(pipelineCalls(log)).toEqual(["Base 704x1280"]);
});

test("a restored result carries its seed", async ({ page }) => {
  const app = new Enso(page);
  await prepare(app);
  const job = await app.generate();
  expect(job.error ?? null).toBeNull();
  expect(job.result?.params?.["seed"]).toBe(-1);
  const seed = job.result?.info?.["seed"];
  expect(typeof seed).toBe("number");

  await app.resultThumb().dblclick();
  await app.openTab("Sampler");
  await expect(app.leftPanel.locator('[data-param="seed"] input')).toHaveValue(String(seed));
});

test("restoring a result brings its inputs back", async ({ page }) => {
  const app = new Enso(page);
  await prepare(app);
  const job = await app.generate();
  expect(job.error ?? null).toBeNull();

  await app.openTab("Input");
  await app.leftPanel.getByRole("button", { name: "Remove portrait.jpg" }).click();
  await expect(app.outlineRow(1)).toHaveAccessibleName("Input 1, Reference, empty");

  await app.resultMenu("Restore inputs");
  await expect(app.outlineRow(1)).toHaveAccessibleName("Input 1, Reference, sent");
  await page.keyboard.press("Control+z");
  await expect(app.outlineRow(1)).toHaveAccessibleName("Input 1, Reference, empty");
});
