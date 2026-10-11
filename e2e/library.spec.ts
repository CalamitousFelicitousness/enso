import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { Enso, PORTRAIT } from "./support/app";

// What the library keeps outlives a reload and comes back into the inputs;
// what is removed waits in the trash. The library is the server's and shared,
// so the entry gets a name of its own and is deleted by its id afterwards. A
// Control frame counts toward no model's image limit, so this runs on any
// loaded model; nothing is generated.

interface Library {
  entries: { pinned: boolean }[];
  cap: number;
}

let folder = "";
let saved: string | null = null;

test.beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "enso-library-"));
  saved = null;
});

test.afterEach(async ({ page }) => {
  if (saved) {
    await page.request.patch(`/sdapi/v2/library/${saved}`, { data: { trashed: true } });
    const gone = await page.request.delete(`/sdapi/v2/library/${saved}`);
    expect(gone.ok(), `DELETE /sdapi/v2/library/${saved} answered ${gone.status()}`).toBe(true);
  }
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
  // the save uploads first, on a cold page
  const posted = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/sdapi/v2/library",
    { timeout: 120_000 },
  );
  await app.frameMenu(2, "Save to library");
  const response = await posted;
  expect(response.ok(), `POST /sdapi/v2/library answered ${response.status()}`).toBe(true);
  saved = ((await response.json()) as { entry: { id: string } }).entry.id;
  await expect
    .poll(() => app.toasts())
    .toContainEqual(expect.stringContaining(`Saved as "${name}"`));

  await app.reopen();
  await app.openRightTab("Library");
  const search = page.getByRole("textbox", { name: "Search saved inputs" });
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
