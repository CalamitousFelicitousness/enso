import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { imageHeader } from "../src/lib/media/dimensions";
import { fitTo, type SizeRule } from "../src/lib/media/sizeRule";
import { Enso, PORTRAIT } from "./support/app";
import { jobLog, loadedCheckpoint, pipelineImages, watchMedia } from "./support/backend";

// A reference goes out at the size the loaded model resizes it to, read from
// the checkpoint's reference_size: the row says the size, the upload is that
// size, the pipeline receives it, and Run again claims it. A picture above
// the server's limit is refused before anything decodes it. The 6x portrait
// (3180x5772) fits to 768x1376 under Qwen-Image 2.1's rule, a size the suite
// already uses.

interface Declared {
  rule: { kind: string; area?: number; multiple?: number; round?: string } | null;
}

let folder = "";

test.beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "enso-sizes-"));
});

test.afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** The portrait drawn six times larger, as a JPEG file. */
async function largePortrait(page: Page): Promise<string> {
  const source = readFileSync(PORTRAIT).toString("base64");
  const made = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    const canvas = new OffscreenCanvas(bitmap.width * 6, bitmap.height * 6);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    const out = new Uint8Array(await blob.arrayBuffer());
    let text = "";
    for (const b of out) text += String.fromCharCode(b);
    return btoa(text);
  }, source);
  const path = join(folder, "portrait-6x.jpg");
  writeFileSync(path, Buffer.from(made, "base64"));
  return path;
}

/** A PNG of a signature and an IHDR claiming the size, with no pixels. */
function headerOnlyPng(width: number, height: number): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const type = Buffer.from("IHDR");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, ihdr])) >>> 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const path = join(folder, "huge.png");
  writeFileSync(path, Buffer.concat([signature, length, type, ihdr, crc]));
  return path;
}

/** The rule a wire declaration names, for the kinds whose fields read alike. */
function areaOrCap(declared: Declared | null | undefined): SizeRule | null {
  const rule = declared?.rule;
  if (rule?.kind === "area" && rule.area && rule.multiple && rule.round) {
    return {
      kind: "area",
      area: rule.area,
      multiple: rule.multiple,
      round: rule.round as "nearest" | "floor" | "ceil",
    };
  }
  if (rule?.kind === "cap" && rule.area) return { kind: "cap", area: rule.area };
  return null;
}

test("a reference goes out at the size the model resizes it to", async ({ page, request }) => {
  const checkpoint = (await loadedCheckpoint(request)) as Awaited<
    ReturnType<typeof loadedCheckpoint>
  > & { reference_size?: Declared | null };
  const rule = areaOrCap(checkpoint.reference_size);
  test.skip(
    !checkpoint.loaded || checkpoint.request_sets_size !== true || rule === null,
    `needs a loaded edit model that declares an area or cap rule for references (loaded: ${checkpoint.name ?? "none"})`,
  );
  const app = new Enso(page);
  await app.open();
  const file = await largePortrait(page);
  const expected = rule && fitTo(rule, { width: 3180, height: 5772 });
  expect(expected, "the rule shrinks the 6x portrait").not.toBeNull();
  const size = `${expected?.width}×${expected?.height}`;

  await app.addReferences(file);
  await expect(app.leftPanel.getByText(`${size} (from 3180×5772)`)).toBeVisible();
  await app.setPrompt("Keep the picture as it is.");
  await app.setSize(704, 1280);
  await app.setSampler("Euler", "Default");
  await app.setSteps(8);

  const media = watchMedia(page);
  const job = await app.generate();
  expect(job.error ?? null).toBeNull();
  await media.settled();
  // the fitted copy is the upload of the expected size; the original goes up beside it for the record
  const sizes: string[] = [];
  for (const upload of media.uploads) {
    if (!upload.hash) continue;
    const blob = await request.get(`/sdapi/v2/blobs/${upload.hash}`);
    const bytes = new Uint8Array(await blob.body());
    const header = await imageHeader((offset, length) =>
      Promise.resolve(bytes.slice(offset, offset + length)),
    );
    if (header.kind !== "unknown" && header.size) {
      sizes.push(`${header.size.width}x${header.size.height}`);
    }
  }
  const wire = `${expected?.width}x${expected?.height}`;
  expect(sizes).toContain(wire);
  const log = jobLog(job.id);
  if (log) expect(pipelineImages(log)).toEqual([wire]);

  const uploads: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/sdapi/v2/blobs") {
      uploads.push(r.url());
    }
  });
  const again = await app.runAgain();
  expect(again.error ?? null).toBeNull();
  expect(uploads, "uploads during Run again").toEqual([]);
});

test("a picture above the server's limit is refused before it is read", async ({ page }) => {
  const app = new Enso(page);
  await app.open();
  const file = headerOnlyPng(15000, 10000);
  await app.openTab("Input");
  await app.outlineRow(1).click();
  await app.leftPanel.getByRole("button", { name: "Reference", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await app.leftPanel.getByRole("button", { name: "Add picture" }).click();
  await (await chooser).setFiles(file);
  await expect.poll(async () => (await app.toasts()).join("\n")).toMatch(/15000×10000/);
  await expect(app.leftPanel.getByRole("button", { name: "Remove huge.png" })).toHaveCount(0);
});
