import { describe, expect, it } from "vitest";
import { imageHeader, type ImageHeader, type Read } from "./dimensions";
import { FIXTURES } from "./dimensions.fixture";

const bytesOf = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));

function reader(bytes: Uint8Array): { read: Read; reads: () => number } {
  let reads = 0;
  return {
    read: (offset, length) => {
      reads += 1;
      return Promise.resolve(bytes.subarray(offset, offset + length));
    },
    reads: () => reads,
  };
}

const header = (bytes: Uint8Array) => imageHeader(reader(bytes).read);

function sized(h: ImageHeader) {
  if (h.kind === "unknown" || h.size === null) return h;
  return { kind: h.kind, ...h.size, orientation: h.orientation, oriented: h.oriented };
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const be32 = (v: number) =>
  new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
const be16 = (v: number) => new Uint8Array([(v >>> 8) & 255, v & 255]);
const text = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const box = (type: string, ...content: Uint8Array[]) => {
  const body = concat(...content);
  return concat(be32(8 + body.length), text(type), body);
};
const full = (version: number, flags: number) => new Uint8Array([version, 0, 0, flags]);

describe("imageHeader on real encoders' files", () => {
  it.each([
    ["png", "png"],
    ["jpeg", "jpeg"],
    ["jpegProgressive", "jpeg"],
    ["webpLossy", "webp"],
    ["webpLossless", "webp"],
    ["gif", "gif"],
    ["bmp", "bmp"],
    ["tiff", "tiff"],
    ["avif", "avif"],
    ["heic", "heic"],
    ["jp2", "jp2"],
    ["jxl", "jxl"],
  ] as const)("reads %s as %s at 37x23", async (key, kind) => {
    expect(sized(await header(bytesOf(FIXTURES[key])))).toMatchObject({
      kind,
      width: 37,
      height: 23,
      orientation: 1,
    });
  });

  it.each(["jpegOriented", "webpOriented", "avifOriented"] as const)(
    "reads the orientation of %s and swaps the shown size",
    async (key) => {
      expect(sized(await header(bytesOf(FIXTURES[key])))).toMatchObject({
        width: 37,
        height: 23,
        orientation: 6,
        oriented: { width: 23, height: 37 },
      });
    },
  );

  it("reads a small file in one read", async () => {
    const r = reader(bytesOf(FIXTURES.png));
    await imageHeader(r.read);
    expect(r.reads()).toBe(1);
  });
});

describe("imageHeader on hand-built headers", () => {
  it("walks past large APP segments by their lengths", async () => {
    const jpeg = bytesOf(FIXTURES.jpeg);
    const app = concat(new Uint8Array([0xff, 0xe2]), be16(65535), new Uint8Array(65533));
    const big = concat(jpeg.subarray(0, 2), ...Array<Uint8Array>(10).fill(app), jpeg.subarray(2));
    const r = reader(big);
    expect(sized(await imageHeader(r.read))).toMatchObject({ kind: "jpeg", width: 37, height: 23 });
    expect(r.reads()).toBeLessThan(20);
  });

  it("finds no size in a JPEG without a frame header", async () => {
    expect(await header(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toEqual({
      kind: "jpeg",
      size: null,
    });
  });

  it("finds no size in a truncated head", async () => {
    expect(await header(bytesOf(FIXTURES.png).subarray(0, 12))).toEqual({
      kind: "png",
      size: null,
    });
  });

  it("takes a GIF's first frame when it outgrows the screen", async () => {
    const gif = concat(
      text("GIF89a"),
      new Uint8Array([10, 0, 10, 0, 0, 0, 0]),
      new Uint8Array([0x2c, 0, 0, 0, 0, 0x30, 0x75, 0x30, 0x75, 0]),
    );
    expect(sized(await header(gif))).toMatchObject({ width: 30000, height: 30000 });
  });

  it("reads a top-down BMP's height as positive", async () => {
    const bmp = bytesOf(FIXTURES.bmp).slice();
    new DataView(bmp.buffer).setInt32(22, -23, true);
    expect(sized(await header(bmp))).toMatchObject({ kind: "bmp", width: 37, height: 23 });
  });

  it("reads a core-header BMP's 16-bit size", async () => {
    const bmp = concat(
      text("BM"),
      new Uint8Array(12),
      new Uint8Array([12, 0, 0, 0, 37, 0, 23, 0, 1, 0, 24, 0]),
    );
    expect(sized(await header(bmp))).toMatchObject({ kind: "bmp", width: 37, height: 23 });
  });

  it("reads a PNG wider than 65535", async () => {
    const png = bytesOf(FIXTURES.png).slice();
    png.set(be32(70000), 16);
    expect(sized(await header(png))).toMatchObject({ width: 70000, height: 23 });
  });

  it("reads a big-endian TIFF with LONG tags and its orientation", async () => {
    const entry = (tag: number, type: number, value: Uint8Array) =>
      concat(be16(tag), be16(type), be32(1), value);
    const tiff = concat(
      text("MM"),
      be16(42),
      be32(8),
      be16(3),
      entry(256, 4, be32(50000)),
      entry(257, 4, be32(40000)),
      entry(274, 3, concat(be16(6), be16(0))),
      be32(0),
    );
    expect(sized(await header(tiff))).toMatchObject({
      kind: "tiff",
      width: 50000,
      height: 40000,
      orientation: 6,
      oriented: { width: 40000, height: 50000 },
    });
  });

  const ispe = (w: number, h: number) => box("ispe", full(0, 0), be32(w), be32(h));
  const ftyp = (major: string) => box("ftyp", text(major), be32(0), text("mif1"));
  const ipma = (entries: [number, number[]][]) =>
    box(
      "ipma",
      full(0, 0),
      be32(entries.length),
      ...entries.map(([item, props]) =>
        concat(be16(item), new Uint8Array([props.length, ...props])),
      ),
    );
  const meta = (primary: number, props: Uint8Array[], associations: [number, number[]][]) =>
    box(
      "meta",
      full(0, 0),
      box("pitm", full(0, 0), be16(primary)),
      box("iprp", box("ipco", ...props), ipma(associations)),
    );

  it("reads the primary item's size through ipma, past a large mdat", async () => {
    const file = concat(
      ftyp("avif"),
      box("mdat", new Uint8Array(300_000)),
      meta(1, [ispe(4000, 3000), box("irot", new Uint8Array([3]))], [[1, [1, 2]]]),
    );
    const r = reader(file);
    expect(sized(await imageHeader(r.read))).toMatchObject({
      kind: "avif",
      width: 4000,
      height: 3000,
      orientation: 6,
      oriented: { width: 3000, height: 4000 },
    });
    expect(r.reads()).toBeLessThan(8);
  });

  it("takes a grid's size, not its tiles'", async () => {
    const file = concat(
      ftyp("heic"),
      meta(
        1,
        [ispe(512, 512), ispe(8000, 6000)],
        [
          [2, [1]],
          [1, [2]],
        ],
      ),
    );
    expect(sized(await header(file))).toMatchObject({ kind: "heic", width: 8000, height: 6000 });
  });

  it("takes a sequence's track when it is larger than its still", async () => {
    const tkhd = box("tkhd", full(0, 0), new Uint8Array(72), be32(4096 << 16), be32(2160 << 16));
    const file = concat(
      ftyp("avis"),
      meta(1, [ispe(512, 512)], [[1, [1]]]),
      box("moov", box("trak", tkhd)),
    );
    expect(sized(await header(file))).toMatchObject({ kind: "avif", width: 4096, height: 2160 });
  });

  it("finds no size in a JPEG 2000 whose header and codestream disagree", async () => {
    const jp2 = bytesOf(FIXTURES.jp2).slice();
    const at = [...jp2.keys()].find(
      (i) => jp2[i] === 0x69 && jp2[i + 1] === 0x68 && jp2[i + 2] === 0x64 && jp2[i + 3] === 0x72,
    );
    jp2.set(be32(99), at! + 8);
    expect(await header(jp2)).toEqual({ kind: "jp2", size: null });
  });

  it("reads a JPEG XL container's codestream, whole or partial", async () => {
    const codestream = bytesOf(FIXTURES.jxl);
    const signature = concat(be32(12), text("JXL "), new Uint8Array([0x0d, 0x0a, 0x87, 0x0a]));
    const ftypJxl = box("ftyp", text("jxl "), be32(0), text("jxl "));
    expect(sized(await header(concat(signature, ftypJxl, box("jxlc", codestream))))).toMatchObject({
      kind: "jxl",
      width: 37,
      height: 23,
    });
    expect(
      sized(await header(concat(signature, ftypJxl, box("jxlp", be32(0), codestream)))),
    ).toMatchObject({
      width: 37,
      height: 23,
    });
  });

  it("knows nothing of other files", async () => {
    expect(await header(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({
      kind: "unknown",
    });
    expect(await header(new Uint8Array(0))).toEqual({ kind: "unknown" });
  });
});
