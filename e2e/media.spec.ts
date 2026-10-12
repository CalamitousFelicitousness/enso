import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Enso, openContext } from "./support/app";
import { watchMedia } from "./support/backend";

// The server keeps what a browser uploads once, by its bytes' hash: a picture
// past the old 50 MB upload limit goes up once and is claimed after, and
// another browser recalls a saved entry and stores no second copy. The
// library is the server's and shared, so entries get names of their own and
// are deleted by id. A Control frame counts toward no model's image limit,
// so this runs on any loaded model; nothing is generated.

interface Library {
  entries: { pinned: boolean }[];
  cap: number;
}

let folder = "";
let saved: string[] = [];

test.beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "enso-media-"));
  saved = [];
});

test.afterEach(async ({ request }) => {
  for (const id of saved) {
    await request.patch(`/sdapi/v2/library/${id}`, { data: { trashed: true } });
    const gone = await request.delete(`/sdapi/v2/library/${id}`);
    expect(gone.ok(), `DELETE /sdapi/v2/library/${id} answered ${gone.status()}`).toBe(true);
  }
  rmSync(folder, { recursive: true, force: true });
});

/** Skip when saving this many entries would push one out of the library. */
async function skipUnlessRoom(request: APIRequestContext, saves: number): Promise<void> {
  const answer = await request.get("/sdapi/v2/library");
  expect(answer.ok(), `GET /sdapi/v2/library answered ${answer.status()}`).toBe(true);
  const library = (await answer.json()) as Library;
  const unpinned = library.entries.filter((e) => !e.pinned).length;
  test.skip(unpinned + saves > library.cap, "the library is full: a save would push an entry out");
}

/** A PNG of random pixels, which no compression shrinks; its size in bytes. */
function noisePng(path: string, side: number): number {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const frame = Buffer.alloc(8 + data.length + 4);
    frame.writeUInt32BE(data.length, 0);
    body.copy(frame, 4);
    frame.writeUInt32BE(crc32(body), 8 + data.length);
    return frame;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  const stride = side * 3 + 1;
  const pixels = randomBytes(stride * side);
  for (let row = 0; row < side; row++) pixels[row * stride] = 0; // no filter
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels, { level: 0 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  return png.length;
}

const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}`;

test("a picture past the old upload limit goes up once, then only as its hash", async ({
  page,
  request,
}) => {
  await skipUnlessRoom(request, 2);
  const name = unique("e2e-media");
  const file = join(folder, `${name}.png`);
  const size = noisePng(file, 4480);
  expect(size).toBeGreaterThan(50 * 1024 * 1024);

  const app = new Enso(page);
  await app.open();
  const traffic = watchMedia(page);
  await app.addControlFrame(file);
  await expect(app.outlineRow(2)).toBeVisible();
  saved.push(await app.saveFrame(2));
  await traffic.settled();
  const picture = traffic.uploads.filter((upload) => upload.size === size);
  expect(picture, "uploads of the picture").toHaveLength(1);
  expect(picture[0]?.created, "the server had no copy before").toBe(true);

  // the page remembers the hash, so a second save of the frame sends none of its bytes
  traffic.clear();
  saved.push(await app.saveFrame(2));
  await traffic.settled();
  expect(traffic.uploads.filter((upload) => upload.size === size)).toEqual([]);
  expect(traffic.present).toContain(picture[0]?.hash);
});

test("another browser recalls a saved entry and keeps one copy of its picture", async ({
  page,
  request,
  browser,
}) => {
  await skipUnlessRoom(request, 2);
  const name = unique("e2e-shared");
  const file = join(folder, `${name}.png`);
  const size = noisePng(file, 1024);

  const app = new Enso(page);
  await app.open();
  const traffic = watchMedia(page);
  await app.addControlFrame(file);
  await expect(app.outlineRow(2)).toBeVisible();
  saved.push(await app.saveFrame(2));
  await traffic.settled();
  const hash = traffic.uploads.find((upload) => upload.size === size)?.hash;
  expect(hash, "the picture went up with the save").toBeTruthy();

  const other = await openContext(browser);
  try {
    // the picture comes from the server by its hash
    const fetched = other.page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/sdapi/v2/blobs/${hash}` && r.ok(),
    );
    await other.openRightTab("Library");
    await other.page.getByRole("textbox", { name: "Search saved inputs" }).fill(name);
    await other.page
      .getByRole("button", { name: new RegExp(`^"${name}", ControlNet frame, 1 picture`) })
      .click();
    await fetched;
    await other.openTab("Input");
    await expect(
      other.leftPanel.getByRole("option", { name: /^Input \d+, ControlNet,/ }),
    ).toHaveCount(1);
    expect(await other.toasts()).not.toContainEqual(expect.stringContaining("could not be read"));

    // the same file picked in this browser is stored under the same hash, not again
    const theirs = watchMedia(other.page);
    await other.addControlFrame(file);
    const rows = other.leftPanel.getByRole("option", { name: /^Input \d+,/ });
    saved.push(await other.saveFrame(await rows.count()));
    await theirs.settled();
    expect(theirs.uploads.filter((upload) => upload.size === size)).toEqual([
      { hash, size, created: false },
    ]);
  } finally {
    await other.page.context().close();
  }
});
