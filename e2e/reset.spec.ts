import { expect, test } from "@playwright/test";
import { Enso, PORTRAIT } from "./support/app";

// Reset Enso in this browser: what the chosen rows held is gone after the
// reload and nothing else is. No model and nothing on the server is needed;
// each test runs in an empty profile of its own.

const CONTENT = [
  "Inputs and results",
  "Prompts and settings",
  "Presets and prompt history",
  "Interface",
];

/** A prompt typed, a picture in Input 1 and the light theme. */
async function seed(app: Enso): Promise<void> {
  await app.setPrompt("a reset check");
  await app.addReferences(PORTRAIT);
  await app.openRightTab("Settings");
  await app.rightPanel.getByRole("button", { name: "Appearance", exact: true }).click();
  await app.rightPanel.getByRole("radio", { name: "Light", exact: true }).click();
  await expect(app.page.locator("html")).toHaveAttribute("data-theme", "light");
}

test("the four content rows return the browser to its first run", async ({ page }) => {
  const app = new Enso(page);
  await app.open();
  await seed(app);

  const notice = await app.reset(CONTENT);
  expect(notice).toContain(
    "Cleared: inputs and results; prompts and settings; presets and prompt history; interface.",
  );
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
  await expect(page.locator(".cm-content").first()).not.toContainText("a reset check");
  // the tutorial waits for the notice to close
  await expect(page.getByRole("button", { name: "Skip", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await app.openTab("Input");
  await expect(app.leftPanel.getByRole("button", { name: /^Remove portrait/ })).toHaveCount(0);
});

test("one row leaves the others as they were", async ({ page }) => {
  const app = new Enso(page);
  await app.open();
  await seed(app);

  await app.reset(["Inputs and results"]);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await app.openTab("Prompts");
  await expect(page.locator(".cm-content").first()).toContainText("a reset check");
  await app.openTab("Input");
  await expect(app.leftPanel.getByRole("button", { name: /^Remove portrait/ })).toHaveCount(0);
});

test("another tab holds the reset until it closes", async ({ page }) => {
  const app = new Enso(page);
  await app.open();
  const other = await app.openAgain();
  await app.page.bringToFront();

  const dialog = await app.resetDialog();
  const reset = dialog.getByRole("button", { name: "Reset", exact: true });
  await expect(dialog.getByRole("status")).toHaveText(
    "Enso is open in 1 other tab. Close it to continue.",
  );
  await expect(reset).toBeDisabled();
  await other.page.close();
  await expect(reset).toBeEnabled({ timeout: 2_000 });
  await expect(dialog.getByRole("status")).toHaveText("");
});

test("a sign-out the server never answered is told after the reset", async ({ page }) => {
  // a server that keeps a session for this page, which then cannot be reached to end it
  await page.route("**/sdapi/v2/session", (route) => {
    if (route.request().method() === "DELETE") return route.abort();
    return route.fulfill({
      json: { required: true, token: "t", expires_at: Date.now() + 3_600_000, user: "someone" },
    });
  });
  const app = new Enso(page);
  await app.open();

  const notice = await app.reset(["Connection"]);
  expect(notice).toContain("Cleared: connection.");
  expect(notice).toContain("The server could not be reached to end the sign-in.");
});
