import { expect, test } from "@playwright/test";
import { Enso } from "./support/app";
import { loadedCheckpoint, type Job } from "./support/backend";

// A recipe saved from a result goes out as a file and comes back: once as the
// entry it came from, and again as a new one after that entry is removed. Run
// from its card it makes the picture again with the seed it was made with. The
// library is the server's and shared, so the entries are deleted by id after.

const BASE = { width: 704, height: 1280 };

interface Library {
  entries: { id: string; name: string; pinned: boolean }[];
  cap: number;
}

let made: string[] = [];

test.beforeEach(async ({ request }) => {
  made = [];
  const checkpoint = await loadedCheckpoint(request);
  test.skip(!checkpoint.loaded, "needs a loaded model");
  const answer = await request.get("/sdapi/v2/library");
  expect(answer.ok(), `GET /sdapi/v2/library answered ${answer.status()}`).toBe(true);
  const library = (await answer.json()) as Library;
  const unpinned = library.entries.filter((e) => !e.pinned).length;
  test.skip(
    unpinned + 2 > library.cap,
    "the library is nearly full: a save would push an entry out",
  );
});

test.afterEach(async ({ page }) => {
  for (const id of made) {
    await page.request.patch(`/sdapi/v2/library/${id}`, { data: { trashed: true } });
    await page.request.delete(`/sdapi/v2/library/${id}`);
  }
});

async function entryNamed(app: Enso, name: string): Promise<string> {
  const answer = await app.page.request.get("/sdapi/v2/library");
  const library = (await answer.json()) as Library;
  const entry = library.entries.find((e) => e.name === name);
  expect(entry, `an entry named "${name}"`).toBeDefined();
  return entry?.id ?? "";
}

test("a recipe goes out as a file, comes back, and runs with its seed", async ({ page }, info) => {
  const app = new Enso(page);
  await app.open();
  const prompt = `a lighthouse on a cliff at dusk ${Date.now().toString(36)}`;
  await app.setPrompt(prompt);
  await app.setSize(BASE.width, BASE.height);
  await app.setSampler("Euler", "Default");
  await app.setSteps(8);
  const first: Job = await app.generate();
  expect(first.error ?? null).toBeNull();
  const seed = first.result?.info?.["seed"];
  expect(typeof seed).toBe("number");

  await app.resultMenu("Save recipe");
  let name = "";
  await expect
    .poll(async () => {
      const saved = (await app.toasts()).find((t) => t.startsWith("Saved as "));
      name = saved?.match(/^Saved as "(.+)"/)?.[1] ?? "";
      return name;
    })
    .not.toBe("");
  const saved = await entryNamed(app, name);
  made.push(saved);

  await app.openRightTab("Library");
  const card = page.locator(`[data-entry-id="${saved}"]`);
  await card.hover();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    card.getByRole("button", { name: "Export as a file" }).click(),
  ]);
  const file = info.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  expect(download.suggestedFilename()).toMatch(/\.enso$/);

  const importFile = async () => {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Import a file" }).click(),
    ]);
    await chooser.setFiles(file);
  };
  // the library holds the entry the file came from
  await importFile();
  await expect
    .poll(() => app.toasts())
    .toContainEqual(expect.stringContaining(`Already in the library as "${name}"`));

  await card.hover();
  await card.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(card).toHaveCount(0);
  await importFile();
  await expect
    .poll(() => app.toasts())
    .toContainEqual(expect.stringContaining(`Imported "${name}"`));
  const imported = await entryNamed(app, name);
  expect(imported).not.toBe(saved);
  made.push(imported);

  const again = page.locator(`[data-entry-id="${imported}"]`);
  await again.getByRole("button", { name: new RegExp(`^"${name}"`) }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("switch", { name: "Model" })).toHaveAccessibleDescription(
    / · Installed$/,
  );
  await dialog.getByRole("button", { name: "Close" }).first().click();

  await again.hover();
  const second = await app.submit(() =>
    again.getByRole("button", { name: "Run", exact: true }).click(),
  );
  expect(second.error ?? null).toBeNull();
  expect(second.result?.info?.["seed"]).toBe(seed);
});
