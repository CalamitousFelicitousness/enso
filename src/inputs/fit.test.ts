import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeriveInput } from "./deriveCore";

const made: DeriveInput[] = [];
let running = 0;
let most = 0;
let release: (() => void)[] = [];

vi.mock("./deriveCore", () => ({
  derivePicture: async (input: DeriveInput) => {
    made.push(input);
    running += 1;
    most = Math.max(most, running);
    await new Promise<void>((resolve) => release.push(resolve));
    running -= 1;
    return new Blob([`${input.fit.width}x${input.fit.height}`]);
  },
}));

let fit: typeof import("./fit");

// one module for every test: each test redraws Blobs of its own
beforeAll(async () => {
  vi.stubGlobal("window", { location: { origin: "http://localhost:5174" } });
  fit = await import("./fit");
});

beforeEach(() => {
  made.length = 0;
  running = 0;
  most = 0;
  release = [];
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const SIZE = { width: 6000, height: 4000 };
const SMALL = { width: 1248, height: 832, mode: "stretch" as const };
const OTHER = { width: 624, height: 416, mode: "stretch" as const };

/** Let every redraw started so far finish, until none is left. */
async function settle() {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const now = release;
    release = [];
    for (const go of now) go();
  }
}

describe("fitBlob", () => {
  it("redraws one Blob at one fit once", async () => {
    const blob = new Blob(["a"]);
    const one = fit.fitBlob(blob, SIZE, SMALL);
    const two = fit.fitBlob(blob, SIZE, SMALL);
    expect(two).toBe(one);
    await settle();
    await one;
    expect(made).toHaveLength(1);
    const other = fit.fitBlob(blob, SIZE, OTHER);
    await settle();
    await other;
    expect(made).toHaveLength(2);
  });

  it("redraws two pictures at a time", async () => {
    const all = [1, 2, 3, 4].map((n) => fit.fitBlob(new Blob([String(n)]), SIZE, SMALL));
    await settle();
    await Promise.all(all);
    expect(made).toHaveLength(4);
    expect(most).toBe(2);
  });

  it("stops a picture Stop reached before its turn, and tries it again next time", async () => {
    const first = fit.fitBlob(new Blob(["a"]), SIZE, SMALL);
    const second = fit.fitBlob(new Blob(["b"]), SIZE, SMALL);
    const controller = new AbortController();
    const blob = new Blob(["c"]);
    const stopped = fit.fitBlob(blob, SIZE, SMALL, controller.signal);
    controller.abort();
    await settle();
    await Promise.all([first, second]);
    await expect(stopped).rejects.toThrow("Upload cancelled");
    expect(made).toHaveLength(2);
    const again = fit.fitBlob(blob, SIZE, SMALL);
    await settle();
    await again;
    expect(made).toHaveLength(3);
  });
});

describe("pngName", () => {
  it("names a redrawn copy as a PNG", () => {
    expect(fit.pngName("cat.jpg")).toBe("cat.png");
    expect(fit.pngName("a.b.webp")).toBe("a.b.png");
    expect(fit.pngName("noext")).toBe("noext.png");
  });
});
