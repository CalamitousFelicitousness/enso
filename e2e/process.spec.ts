import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { Enso } from "./support/app";
import { fileHash, jobLog, watchMedia, type Job } from "./support/backend";

// A Process job with a color LUT applies it, runs again on the refs it was
// sent with, and after a reload sends the LUT as its hash while the picture,
// which the page no longer holds, goes again. Process needs no model.

const INVERT = fileURLToPath(new URL("./fixtures/invert.cube", import.meta.url));
/** 64x64 of one color, rgb(200, 100, 50). */
const SOLID = fileURLToPath(new URL("./fixtures/solid.png", import.meta.url));
const INVERTED = [55, 155, 205];

/** The color at the centre of a job's first image, read by the page. */
async function centre(page: Page, job: Job): Promise<number[]> {
  const url = job.result?.images[0]?.url;
  expect(url, `job ${job.id} has an image`).toBeTruthy();
  return page.evaluate(async (src) => {
    const response = await fetch(src);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2D context");
    context.drawImage(bitmap, 0, 0);
    const [r, g, b] = context.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data;
    return [r ?? 0, g ?? 0, b ?? 0];
  }, url ?? "");
}

/** The LUT inverted the fixture's color, within what a lossy save moves it. */
function expectInverted(color: number[]): void {
  color.forEach((value, channel) => {
    expect(
      Math.abs(value - (INVERTED[channel] ?? 0)),
      `channel ${channel} of ${color.join(", ")}`,
    ).toBeLessThan(8);
  });
}

/** A job as posted, less its queue position, which a run again leaves out. */
function withoutPriority(job: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(job ?? {}).filter(([key]) => key !== "priority"));
}

/** The job's log window holds no line saying the LUT could not be applied. */
function expectLutRead(job: Job): void {
  const log = jobLog(job.id);
  if (log) expect(log.filter((line) => line.includes("Grading LUT:"))).toEqual([]);
}

test("a Process job applies its LUT, runs again on the same refs, and sends the LUT as its hash after a reload", async ({
  page,
}) => {
  const lutSize = statSync(INVERT).size;
  const pictureSize = statSync(SOLID).size;
  const app = new Enso(page);
  await app.open();
  await app.processFiles(SOLID);
  await app.setSwitch("Save output", false);
  await app.processSection("Color Grading");
  await app.expand("LUT");
  const traffic = watchMedia(page);
  await app.leftPanel.locator('input[type=file][accept=".cube"]').setInputFiles(INVERT);
  await expect(app.leftPanel.getByText("invert.cube", { exact: true }).first()).toBeVisible();

  const first = await app.process();
  expect(first.error ?? null).toBeNull();
  expectInverted(await centre(page, first));
  expectLutRead(first);
  await traffic.settled();
  const lut = traffic.uploads.find((upload) => upload.size === lutSize);
  expect(lut, "the LUT went up with the job").toBeTruthy();
  const sent = withoutPriority(traffic.jobs[0]);

  // the server holds every file the job sent, so nothing goes up again
  traffic.clear();
  const again = await app.runAgainFromHistory();
  expect(again.error ?? null).toBeNull();
  expectInverted(await centre(page, again));
  await traffic.settled();
  expect(traffic.uploads, "uploads during Run again").toEqual([]);
  expect(withoutPriority(traffic.jobs[0])).toEqual(sent);

  // the page keeps the LUT's hash across a reload, not the picture's
  await app.reopen();
  traffic.clear();
  await app.processFiles(SOLID);
  const reloaded = await app.process();
  expect(reloaded.error ?? null).toBeNull();
  expectInverted(await centre(page, reloaded));
  expectLutRead(reloaded);
  await traffic.settled();
  expect(traffic.uploads.map((upload) => upload.size)).toEqual([pictureSize]);
  expect(traffic.present).toContain(fileHash(INVERT));
});
