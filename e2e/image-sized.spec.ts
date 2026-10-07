import { expect, test } from "@playwright/test";
import { Enso, PORTRAIT } from "./support/app";
import { imageSizes, loadedCheckpoint } from "./support/backend";

// A loaded model that generates a lone Reference at the image's size: SD 1.5,
// SDXL and every other pipeline with no condition-image declaration.

let multiple = 8;

test.beforeEach(async ({ request }) => {
  const checkpoint = await loadedCheckpoint(request);
  multiple = checkpoint.size_multiple ?? 8;
  test.skip(
    !checkpoint.loaded || checkpoint.request_sets_size !== false,
    `needs a loaded model that sizes a lone Reference from the image (loaded: ${checkpoint.name ?? "none"})`,
  );
});

test("a lone Reference locks Size to the image", async ({ page }) => {
  // The fixture is 530x962; the server rounds each side up to the size multiple
  const up = (value: number) => Math.ceil(value / multiple) * multiple;
  const size = `${up(530)}x${up(962)}`;
  const app = new Enso(page);
  await app.open();
  await app.addReferences(PORTRAIT);
  await app.setPrompt("A woman on a neon-lit street at night");
  await app.openTab("Prompts");

  await expect(app.slider("Width")).toHaveAttribute("aria-disabled", "true");
  await expect(app.slider("Height")).toHaveAttribute("aria-disabled", "true");
  await expect(
    app.leftPanel.getByText(
      `This model generates at the size of its input image: ${size.replace("x", "×")}.`,
    ),
  ).toBeVisible();
  expect(await app.outputFrameSize()).toBe(size);

  await app.setSteps(8);
  const job = await app.generate();
  expect(job.error ?? null).toBeNull();
  expect(imageSizes(job)).toEqual([size]);
});

test("switching the Reference to Initial unlocks Size", async ({ page }) => {
  const app = new Enso(page);
  await app.open();
  await app.addReferences(PORTRAIT);
  await app.openTab("Prompts");
  await app.leftPanel.getByRole("button", { name: "switch Input 1 to Initial" }).click();

  await expect(app.slider("Width")).not.toHaveAttribute("aria-disabled", "true");
  await expect(app.canvas.getByText(/^Input 1 \(Initial/)).toBeVisible();
});
