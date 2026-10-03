import { expect, test } from "@playwright/test";
import { Enso, PORTRAIT } from "./support/app";
import { imageSizes, jobLog, loadedCheckpoint, pipelineCalls } from "./support/backend";

// A loaded model that takes several input images and sizes its output from
// the request: Qwen-Image 2.1, Qwen Edit Plus, FLUX.2, Klein.
// Sizes stay on one base and one hires size: every new size makes the server
// retune its kernels, and sdnext fails a job past a few hundred of them.
const BASE = { width: 704, height: 1280 };
const HIRES_SCALE = 1.5;
const HIRES = "1056x1920";
const EDIT = "Change the neon sign color from pink to bright green. Keep everything else the same.";

let inputLimit = 1;
let strengthIgnored = false;

test.beforeEach(async ({ request }) => {
  const checkpoint = await loadedCheckpoint(request);
  inputLimit = checkpoint.max_input_images ?? 1;
  strengthIgnored = checkpoint.strength_applicable === false;
  test.skip(
    !checkpoint.loaded || checkpoint.request_sets_size !== true || inputLimit < 2,
    `needs a loaded edit model that takes several input images (loaded: ${checkpoint.name ?? "none"})`,
  );
});

async function prepare(app: Enso, references: number): Promise<void> {
  await app.open();
  await app.addReferences(...Array<string>(references).fill(PORTRAIT));
  await app.setPrompt(EDIT);
  await app.setSize(BASE.width, BASE.height);
  // The first-run sampler is Euler, which flow-match models reject
  await app.setSampler("Euler", "Default");
  await app.setSteps(8);
}

test("a lone Reference generates at the requested size", async ({ page }) => {
  const app = new Enso(page);
  await prepare(app, 1);
  expect(await app.outputFrameSize()).toBe("704x1280");

  const job = await app.generate();
  expect(job.error ?? null).toBeNull();
  expect(imageSizes(job)).toEqual(["704x1280"]);
  const log = jobLog(job.id);
  if (log) expect(pipelineCalls(log)).toEqual(["Base 704x1280"]);
});

test("several references generate at the requested size, color corrected", async ({ page }) => {
  const app = new Enso(page);
  await prepare(app, 2);
  await app.openTab("Color");
  await app.enable("Color Correction");

  const job = await app.generate();
  expect(job.error ?? null).toBeNull();
  expect(imageSizes(job)).toEqual(["704x1280"]);
  const log = jobLog(job.id);
  if (log) {
    expect(pipelineCalls(log)).toEqual(["Base 704x1280"]);
    expect(log.some((line) => line.includes("Applying color correction"))).toBe(true);
  }
});

test("hires runs a second pass at the hires size", async ({ page }) => {
  const app = new Enso(page);
  await prepare(app, 1);
  await app.openTab("Refine");
  await app.enable("Hires Fix");
  await app.setSlider("Scale", HIRES_SCALE);
  // The model takes pixels: no latent upscaler, and the second pass always runs
  const force = app.leftPanel.getByRole("checkbox", { name: "Force hires" });
  await expect(force).toBeChecked();
  await expect(force).toBeDisabled();
  expect(await app.outputFrameSize()).toBe(HIRES);

  const job = await app.generate();
  expect(job.error ?? null).toBeNull();
  expect(imageSizes(job)).toEqual([HIRES]);
  const log = jobLog(job.id);
  if (log) {
    expect(pipelineCalls(log)).toEqual(["Base 704x1280", `Hires ${HIRES}`]);
    expect(log.some((line) => line.includes('upscaler="Resize Lanczos"'))).toBe(true);
    expect(log.some((line) => line.includes("Resize upscaler: invalid"))).toBe(false);
  }
  // The server's warnings for the job are on its result
  if (strengthIgnored) {
    await app.canvas.getByTitle(/from the server during this job/).click();
    await expect(page.getByText(/Hires: model=.* strength=ignored/)).toBeVisible();
  }
});

test("every output of a hires batch is shown", async ({ page }) => {
  const app = new Enso(page);
  await prepare(app, 1);
  await app.openTab("Prompts");
  await app.setSlider("Count", 2);
  await app.openTab("Refine");
  await app.enable("Hires Fix");
  await app.setSlider("Scale", HIRES_SCALE);

  const job = await app.generate();
  expect(job.error ?? null).toBeNull();
  expect(imageSizes(job)).toEqual([HIRES, HIRES]);
  await expect(app.leftPanel.getByTitle("Batch of 2 - click to expand")).toBeVisible();
});

test("the detailer redraws a face from its own prompt", async ({ page }) => {
  const detailPrompt = "A sharp, detailed face of the same woman";
  const app = new Enso(page);
  await prepare(app, 1);
  await app.openTab("Detail");
  await app.enable("Detailer");
  const notice = app.leftPanel.getByText("This model redraws each detected region from a prompt");
  await expect(notice).toBeVisible();
  await app.leftPanel.locator(".cm-content").filter({ visible: true }).first().fill(detailPrompt);
  await expect(notice).toBeHidden();
  await expect(app.slider("Strength")).toHaveAttribute("aria-disabled", "true");

  const job = await app.generate();
  expect(job.error ?? null).toBeNull();
  expect(imageSizes(job)).toEqual(["704x1280"]);
  const log = jobLog(job.id);
  if (log) {
    expect(pipelineCalls(log)).toEqual(["Base 704x1280", "Detail 1024x1024"]);
    expect(log.some((line) => line.includes(`prompt="${detailPrompt}"`))).toBe(true);
    expect(log.some((line) => line.includes("Detailer prompt: empty"))).toBe(false);
  }
});

test("inputs stop at the model's limit", async ({ page }) => {
  const app = new Enso(page);
  await app.open();
  await app.addReferences(...Array<string>(inputLimit).fill(PORTRAIT));
  const full = "This model takes no more input images";
  await expect(app.canvas.getByRole("button", { name: "Add Input Frame" })).toBeDisabled();
  await expect(app.canvas.getByRole("button", { name: "Add Input Frame" })).toHaveAttribute(
    "title",
    full,
  );
  await expect(app.canvas.getByTitle(full).first()).toBeDisabled();
});
