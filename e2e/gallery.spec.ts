import { expect, test } from "@playwright/test";
import { Enso } from "./support/app";
import { deleteOutput, findOutput, loadedCheckpoint, savedName, type Job } from "./support/backend";

// An output found in the Gallery names the job that made it and runs that job
// again with the request it was sent with, and goes to the trash and comes
// back from it. Runs on any loaded model, at the base size the other specs
// use; the jobs, and the files of the trash spec, are deleted after.

let jobs: string[] = [];
let files: string[] = [];

test.beforeEach(async ({ request }) => {
  const checkpoint = await loadedCheckpoint(request);
  test.skip(!checkpoint.loaded, "needs a loaded model");
  jobs = [];
  files = [];
});

test.afterEach(async ({ request }) => {
  for (const id of jobs) await request.delete(`/sdapi/v2/jobs/${id}`);
  for (const path of files) await deleteOutput(request, path);
});

async function generate(app: Enso): Promise<Job> {
  await app.setPrompt("A lighthouse at dusk, oil painting");
  await app.setSize(704, 1280);
  await app.setSampler("Euler", "Default");
  await app.setSteps(8);
  const job = await app.generate();
  jobs.push(job.id);
  expect(job.error ?? null).toBeNull();
  return job;
}

test("an output in the Gallery names its job and runs it again", async ({ page, request }) => {
  const app = new Enso(page);
  await app.open();
  const first = await generate(app);

  const name = await savedName(request, first);
  await app.galleryFile((await findOutput(request, name)).label, name);
  await expect(app.canvas.getByText(/^From an Enso image job/)).toBeVisible();

  const again = await app.submit(() =>
    app.canvas.getByRole("button", { name: /^Run again/ }).click(),
  );
  jobs.push(again.id);
  expect(again.error ?? null).toBeNull();
  expect(again.result?.params).toEqual(first.result?.params);
});

test("a deleted output is in the Trash folder and comes back on Restore", async ({
  page,
  request,
}) => {
  const app = new Enso(page);
  await app.open();
  const name = await savedName(request, await generate(app));
  const before = await findOutput(request, name);
  files.push(before.path);
  const sidecar = before.path.replace(/\.[^./]+$/, ".txt");

  await app.galleryFile(before.label, name);
  await app.canvas.getByRole("button", { name, exact: true }).dispatchEvent("contextmenu");
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect
    .poll(() => app.toasts())
    .toContainEqual(expect.stringContaining(`"${name}" moved to the trash`));

  await app.galleryTrash();
  await page.getByPlaceholder("Search files...").fill(name);
  await app.canvas.getByRole("button", { name, exact: true }).click();
  await expect(app.canvas.getByText(/^Was in /)).toBeVisible();

  await app.restoreFiles();
  await expect
    .poll(() => app.toasts())
    .toContainEqual(expect.stringContaining(`"${name}" restored`));
  const after = await findOutput(request, name);
  expect(after.path).toBe(before.path);
  // the infotext saved beside it went to the trash and came back with it
  if (before.tree.includes(sidecar)) expect(after.tree).toContain(sidecar);
});
