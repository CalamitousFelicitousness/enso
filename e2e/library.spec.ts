import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { Enso, PORTRAIT } from "./support/app";
import { deleteOutput, findOutput, loadedCheckpoint, savedName } from "./support/backend";

// What the library keeps outlives a reload and comes back into the inputs;
// what is removed waits in the trash. The library is the server's and shared,
// so the entry gets a name of its own and is deleted by its id afterwards. A
// Control frame counts toward no model's image limit, so the first test runs on
// any loaded model and generates nothing; the second makes a file of its own to
// count in the trash, and deletes it after.

interface Library {
  entries: { pinned: boolean }[];
  cap: number;
}

let folder = "";
let saved: string | null = null;
let jobs: string[] = [];
let files: string[] = [];

test.beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "enso-library-"));
  saved = null;
  jobs = [];
  files = [];
});

test.afterEach(async ({ page }) => {
  if (saved) {
    await page.request.patch(`/sdapi/v2/library/${saved}`, { data: { trashed: true } });
    const gone = await page.request.delete(`/sdapi/v2/library/${saved}`);
    expect(gone.ok(), `DELETE /sdapi/v2/library/${saved} answered ${gone.status()}`).toBe(true);
  }
  for (const id of jobs) await page.request.delete(`/sdapi/v2/jobs/${id}`);
  for (const path of files) await deleteOutput(page.request, path);
  rmSync(folder, { recursive: true, force: true });
});

test("a saved frame comes back after a reload, and a removed one from the trash", async ({
  page,
}) => {
  const answer = await page.request.get("/sdapi/v2/library");
  expect(answer.ok(), `GET /sdapi/v2/library answered ${answer.status()}`).toBe(true);
  const library = (await answer.json()) as Library;
  const unpinned = library.entries.filter((e) => !e.pinned).length;
  test.skip(unpinned >= library.cap, "the library is full: a save would push an entry out");

  const name = `e2e-library-${Date.now().toString(36)}`;
  const file = join(folder, `${name}.jpg`);
  copyFileSync(PORTRAIT, file);

  const app = new Enso(page);
  await app.open();
  await app.addControlFrame(file);
  await expect(app.outlineRow(2)).toBeVisible();
  saved = await app.saveFrame(2);
  await expect
    .poll(() => app.toasts())
    .toContainEqual(expect.stringContaining(`Saved as "${name}"`));

  await app.reopen();
  await app.openRightTab("Library");
  const search = page.getByRole("textbox", { name: "Search the library" });
  await search.fill(name);
  const card = page.getByRole("button", {
    name: new RegExp(`^"${name}", ControlNet frame, 1 picture`),
  });
  await expect(card).toBeVisible();
  // a frame's card adds it to the inputs
  await card.click();
  await expect(app.outlineRow(3)).toBeVisible();

  await app.openTab("Input");
  await app.leftPanel.getByRole("button", { name: "Remove Input 3" }).click();
  await expect(app.outlineRow(3)).toHaveCount(0);

  // the search is shared by both lists
  await search.fill("");
  await page.getByRole("radio", { name: "Trash" }).click();
  const removed = page
    .getByRole("list", { name: "Trash" })
    .getByRole("listitem")
    .filter({ hasText: "Input 3 (ControlNet, 1 layer)" });
  await expect(removed).toBeVisible();
  await removed.getByRole("button", { name: "Restore" }).click();
  await expect(app.outlineRow(3)).toBeVisible();
});

/** The trash's line for the Gallery's files, at this many files. */
function filesLine(n: number): string | RegExp {
  if (n === 0) return "No files in the trash";
  return new RegExp(`^${n.toLocaleString("en-US")} files? in the trash on the server`);
}

test("the trash counts the Gallery's files on a line of its own", async ({ page }) => {
  const checkpoint = await loadedCheckpoint(page.request);
  test.skip(!checkpoint.loaded, "needs a loaded model to make a file of its own");

  const app = new Enso(page);
  await app.open();
  await app.setPrompt("A lighthouse at dusk, oil painting");
  await app.setSize(704, 1280);
  await app.setSampler("Euler", "Default");
  await app.setSteps(8);
  const job = await app.generate();
  jobs.push(job.id);
  expect(job.error ?? null).toBeNull();
  const output = await findOutput(page.request, await savedName(page.request, job));
  files.push(output.path);

  await app.openRightTab("Library");
  await page.getByRole("radio", { name: "Trash" }).click();
  const listed = (await (await page.request.get("/sdapi/v2/browser/trash")).json()) as {
    total: number;
  };
  await expect(app.rightPanel.getByText(filesLine(listed.total))).toBeVisible();

  // a file saved within the last few seconds is refused as still being saved
  let item = "";
  await expect(async () => {
    const answer = await page.request.post("/sdapi/v2/browser/trash", {
      data: { files: [output.path] },
    });
    expect(answer.ok(), `POST /sdapi/v2/browser/trash answered ${answer.status()}`).toBe(true);
    const body = (await answer.json()) as { trashed: { id: string }[] };
    item = body.trashed[0]?.id ?? "";
    expect(item).not.toBe("");
  }).toPass({ timeout: 15_000 });
  // the line follows the server's event, not this page's own write
  await expect(app.rightPanel.getByText(filesLine(listed.total + 1))).toBeVisible();

  const restored = await page.request.post("/sdapi/v2/browser/trash/restore", {
    data: { ids: [item] },
  });
  expect(restored.ok(), `POST /sdapi/v2/browser/trash/restore answered ${restored.status()}`).toBe(
    true,
  );
  await expect(app.rightPanel.getByText(filesLine(listed.total))).toBeVisible();
});
