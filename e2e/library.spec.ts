import { expect, test } from "@playwright/test";
import { Enso, PORTRAIT } from "./support/app";

// What the library keeps outlives a reload and comes back into the inputs;
// what is removed waits in the trash. A Control frame counts toward no
// model's image limit, so this runs on any loaded model; nothing is generated.

test("a saved frame comes back after a reload, and a removed one from the trash", async ({
  page,
}) => {
  const app = new Enso(page);
  await app.open();
  await app.addControlFrame(PORTRAIT);
  await expect(app.outlineRow(2)).toBeVisible();
  await app.frameMenu(2, "Save to library");
  await expect
    .poll(() => app.toasts())
    .toContainEqual(expect.stringContaining('Saved as "portrait"'));

  await app.reopen();
  await app.openRightTab("Library");
  const card = page.getByRole("button", { name: /^"portrait", ControlNet frame, 1 picture/ });
  await expect(card).toBeVisible();
  // a frame's card adds it to the inputs
  await card.click();
  await expect(app.outlineRow(3)).toBeVisible();

  await app.openTab("Input");
  await app.leftPanel.getByRole("button", { name: "Remove Input 3" }).click();
  await expect(app.outlineRow(3)).toHaveCount(0);

  await page.getByRole("radio", { name: "Trash" }).click();
  const removed = page
    .getByRole("list", { name: "Trash" })
    .getByRole("listitem")
    .filter({ hasText: "Input 3 (ControlNet, 1 layer)" });
  await expect(removed).toBeVisible();
  await removed.getByRole("button", { name: "Restore" }).click();
  await expect(app.outlineRow(3)).toBeVisible();
});
