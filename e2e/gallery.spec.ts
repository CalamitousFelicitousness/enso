import { expect, test, type APIRequestContext } from "@playwright/test";
import { Enso } from "./support/app";
import { loadedCheckpoint, type Job } from "./support/backend";

// An output found in the Gallery names the job that made it and runs that job
// again with the request it was sent with. Runs on any loaded model, at the
// base size the other specs use; both jobs are deleted after.

let jobs: string[] = [];

test.beforeEach(async ({ request }) => {
  const checkpoint = await loadedCheckpoint(request);
  test.skip(!checkpoint.loaded, "needs a loaded model");
  jobs = [];
});

test.afterEach(async ({ request }) => {
  for (const id of jobs) await request.delete(`/sdapi/v2/jobs/${id}`);
});

/** The name the server saved a job's first image under. */
async function savedName(request: APIRequestContext, job: Job): Promise<string> {
  const url = job.result?.images[0]?.url ?? "";
  const answer = await request.get(url);
  expect(answer.ok(), `GET ${url} answered ${answer.status()}`).toBe(true);
  const disposition = answer.headers()["content-disposition"] ?? "";
  const name = /filename\*=utf-8''([^;]+)/i.exec(disposition)?.[1];
  expect(name, `a file name in "${disposition}"`).toBeTruthy();
  return decodeURIComponent(name ?? "");
}

/** The label of the Gallery folder whose tree holds a file of this name. */
async function folderOf(request: APIRequestContext, name: string): Promise<string> {
  const roots = (await (await request.get("/sdapi/v2/browser/folders")).json()) as {
    path: string;
    label: string;
  }[];
  for (const root of roots) {
    const answer = await request.get("/sdapi/v2/browser/files", { params: { folder: root.path } });
    if (!answer.ok()) continue;
    const files = (await answer.json()) as string[];
    const names = files.map((f) =>
      decodeURIComponent(f.split("##F##")[1] ?? "")
        .split("/")
        .pop(),
    );
    if (names.includes(name)) return root.label;
  }
  throw new Error(`no Gallery folder holds ${name}`);
}

test("an output in the Gallery names its job and runs it again", async ({ page, request }) => {
  const app = new Enso(page);
  await app.open();
  await app.setPrompt("A lighthouse at dusk, oil painting");
  await app.setSize(704, 1280);
  await app.setSampler("Euler", "Default");
  await app.setSteps(8);
  const first = await app.generate();
  jobs.push(first.id);
  expect(first.error ?? null).toBeNull();

  const name = await savedName(request, first);
  await app.galleryFile(await folderOf(request, name), name);
  await expect(app.canvas.getByText(/^From an Enso image job/)).toBeVisible();

  const again = await app.submit(() =>
    app.canvas.getByRole("button", { name: /^Run again/ }).click(),
  );
  jobs.push(again.id);
  expect(again.error ?? null).toBeNull();
  expect(again.result?.params).toEqual(first.result?.params);
});
