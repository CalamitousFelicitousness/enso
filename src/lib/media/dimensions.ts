// A picture's kind, size and orientation from its header, read without decoding.
// The formats are the ones the server's sniff knows (enso_api/media/sniff.py).

export type ImageKind =
  "png" | "jpeg" | "webp" | "gif" | "bmp" | "tiff" | "avif" | "heic" | "jp2" | "jxl";

export const KIND_NAMES: Record<ImageKind, string> = {
  png: "PNG",
  jpeg: "JPEG",
  webp: "WebP",
  gif: "GIF",
  bmp: "BMP",
  tiff: "TIFF",
  avif: "AVIF",
  heic: "HEIC",
  jp2: "JPEG 2000",
  jxl: "JPEG XL",
};

export interface PixelSize {
  width: number;
  height: number;
}

/** Bytes from `offset`, fewer at the end of the file. */
export type Read = (offset: number, length: number) => Promise<Uint8Array>;

export type ImageHeader =
  | { kind: "unknown" }
  /** A known format whose size the reader could not find. */
  | { kind: ImageKind; size: null }
  /** `orientation` is the EXIF value (1 to 8); `oriented` the size as shown. */
  | { kind: ImageKind; size: PixelSize; orientation: number; oriented: PixelSize };

const PAGE = 4096;
const MAX_PAGES = 256;
const MAX_SEGMENTS = 512;
const MAX_BOXES = 512;

class Unreadable extends Error {}

/** Cached 4 KB pages over the reader; a walk past the page budget gives up. */
class Bytes {
  private readonly pages = new Map<number, Uint8Array>();
  private readonly read: Read;
  constructor(read: Read) {
    this.read = read;
  }

  async at(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || length < 0) throw new Unreadable();
    const out = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const pos = offset + filled;
      const index = Math.floor(pos / PAGE);
      let page = this.pages.get(index);
      if (!page) {
        if (this.pages.size >= MAX_PAGES) throw new Unreadable();
        page = await this.read(index * PAGE, PAGE);
        this.pages.set(index, page);
      }
      const from = pos - index * PAGE;
      if (from >= page.length) throw new Unreadable();
      const take = Math.min(length - filled, page.length - from);
      out.set(page.subarray(from, from + take), filled);
      filled += take;
    }
    return out;
  }
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32be = (b: Uint8Array, i: number) =>
  ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const u32le = (b: Uint8Array, i: number) =>
  ((b[i + 3] << 24) >>> 0) + ((b[i + 2] << 16) | (b[i + 1] << 8) | b[i]);
const i32le = (b: Uint8Array, i: number) =>
  b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
const starts = (b: Uint8Array, bytes: number[]) => bytes.every((v, i) => b[i] === v);

function kindOf(head: Uint8Array): ImageKind | null {
  if (starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") return "gif";
  if (starts(head, [0xff, 0x0a])) return "jxl";
  if (starts(head, [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) return "jxl";
  if (starts(head, [0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) return "jp2";
  if (starts(head, [0x49, 0x49, 0x2a, 0]) || starts(head, [0x4d, 0x4d, 0, 0x2a])) return "tiff";
  if (ascii(head, 0, 2) === "BM" && [12, 40, 52, 56, 64, 108, 124].includes(u32le(head, 14)))
    return "bmp";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return "webp";
  if (ascii(head, 4, 4) === "ftyp" && head.length >= 12) {
    const size = Math.min(u32be(head, 0), head.length);
    const major = ascii(head, 8, 4);
    const brands = new Set([major]);
    for (let i = 16; i + 4 <= size; i += 4) brands.add(ascii(head, i, 4));
    const avif = brands.has("avif") || brands.has("avis");
    if (major === "avif" || major === "avis" || ((major === "mif1" || major === "msf1") && avif))
      return "avif";
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"].some((b) => brands.has(b)))
      return "heic";
    if (major === "mif1" || major === "msf1") return "heic";
  }
  return null;
}

/** The EXIF orientation tag (274) in a TIFF structure starting at `start`. */
async function tiffOrientation(bytes: Bytes, start: number): Promise<number> {
  const head = await bytes.at(start, 8);
  const le = head[0] === 0x49;
  const u16 = le ? u16le : u16be;
  const u32 = le ? u32le : u32be;
  const ifd = start + u32(head, 4);
  const count = u16(await bytes.at(ifd, 2), 0);
  if (count > 512) return 1;
  const entries = await bytes.at(ifd + 2, count * 12);
  for (let i = 0; i < count; i++) {
    if (u16(entries, i * 12) === 274) {
      const value = u16(entries, i * 12 + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

async function exifOrientation(bytes: Bytes, start: number, length: number): Promise<number> {
  const prefix = await bytes.at(start, Math.min(length, 6));
  const tiff = ascii(prefix, 0, 6) === "Exif\0\0" ? start + 6 : start;
  try {
    return await tiffOrientation(bytes, tiff);
  } catch {
    return 1;
  }
}

type Found = { width: number; height: number; orientation: number } | null;

async function png(bytes: Bytes): Promise<Found> {
  const ihdr = await bytes.at(8, 16);
  if (ascii(ihdr, 4, 4) !== "IHDR") return null;
  const found = { width: u32be(ihdr, 8), height: u32be(ihdr, 12), orientation: 1 };
  let pos = 8 + 12 + 13;
  for (let i = 0; i < 64; i++) {
    const header = await bytes.at(pos, 8);
    const length = u32be(header, 0);
    const type = ascii(header, 4, 4);
    if (type === "IDAT" || type === "IEND") break;
    if (type === "eXIf") {
      found.orientation = await exifOrientation(bytes, pos + 8, length);
      break;
    }
    pos += 12 + length;
  }
  return found;
}

async function gif(bytes: Bytes): Promise<Found> {
  const head = await bytes.at(0, 13);
  let width = u16le(head, 6);
  let height = u16le(head, 8);
  let pos = 13 + (head[10] & 0x80 ? 3 * 2 ** ((head[10] & 7) + 1) : 0);
  for (let i = 0; i < MAX_SEGMENTS; i++) {
    const [block] = await bytes.at(pos, 1);
    if (block === 0x2c) {
      const d = await bytes.at(pos + 1, 8);
      width = Math.max(width, u16le(d, 0) + u16le(d, 4));
      height = Math.max(height, u16le(d, 2) + u16le(d, 6));
      break;
    }
    if (block !== 0x21) break;
    pos += 2;
    for (let blocks = 0; ; blocks++) {
      if (blocks > 65536) return null;
      const [size] = await bytes.at(pos, 1);
      pos += 1 + size;
      if (size === 0) break;
    }
  }
  return { width, height, orientation: 1 };
}

async function bmp(bytes: Bytes): Promise<Found> {
  const head = await bytes.at(14, 12);
  if (u32le(head, 0) === 12)
    return { width: u16le(head, 4), height: u16le(head, 6), orientation: 1 };
  return { width: i32le(head, 4), height: Math.abs(i32le(head, 8)), orientation: 1 };
}

async function webp(bytes: Bytes): Promise<Found> {
  const head = await bytes.at(12, 18);
  const chunk = ascii(head, 0, 4);
  if (chunk === "VP8 ") {
    if (!(head[11] === 0x9d && head[12] === 0x01 && head[13] === 0x2a)) return null;
    return { width: u16le(head, 14) & 0x3fff, height: u16le(head, 16) & 0x3fff, orientation: 1 };
  }
  if (chunk === "VP8L") {
    const b = head.subarray(9);
    const width = 1 + (((b[1] & 0x3f) << 8) | b[0]);
    const height = 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6));
    return { width, height, orientation: 1 };
  }
  if (chunk !== "VP8X") return null;
  const flags = head[8];
  const width = 1 + (head[12] | (head[13] << 8) | (head[14] << 16));
  const extra = await bytes.at(27, 3);
  const height = 1 + (extra[0] | (extra[1] << 8) | (extra[2] << 16));
  let orientation = 1;
  if (flags & 0x08) {
    let pos = 12;
    for (let i = 0; i < 64; i++) {
      const header = await bytes.at(pos, 8);
      const size = u32le(header, 4);
      if (ascii(header, 0, 4) === "EXIF") {
        orientation = await exifOrientation(bytes, pos + 8, size);
        break;
      }
      pos += 8 + size + (size & 1);
    }
  }
  return { width, height, orientation };
}

async function tiff(bytes: Bytes): Promise<Found> {
  const head = await bytes.at(0, 8);
  const le = head[0] === 0x49;
  const u16 = le ? u16le : u16be;
  const u32 = le ? u32le : u32be;
  const ifd = u32(head, 4);
  const count = u16(await bytes.at(ifd, 2), 0);
  if (count > 512) return null;
  const entries = await bytes.at(ifd + 2, count * 12);
  let width = 0;
  let height = 0;
  let orientation = 1;
  for (let i = 0; i < count; i++) {
    const at = i * 12;
    const tag = u16(entries, at);
    const value = u16(entries, at + 2) === 3 ? u16(entries, at + 8) : u32(entries, at + 8);
    if (tag === 256) width = value;
    else if (tag === 257) height = value;
    else if (tag === 274 && value >= 1 && value <= 8) orientation = value;
  }
  return { width, height, orientation };
}

async function jpeg(bytes: Bytes): Promise<Found> {
  let pos = 2;
  let orientation = 1;
  for (let i = 0; i < MAX_SEGMENTS; i++) {
    const head = await bytes.at(pos, 4);
    if (head[0] !== 0xff) return null;
    const marker = head[1];
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = u16be(head, 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const sof = await bytes.at(pos + 4, 5);
      return { width: u16be(sof, 3), height: u16be(sof, 1), orientation };
    }
    if (marker === 0xe1 && orientation === 1) {
      const id = await bytes.at(pos + 4, 6);
      if (ascii(id, 0, 6) === "Exif\0\0")
        orientation = await exifOrientation(bytes, pos + 4, length - 2);
    }
    pos += 2 + length;
  }
  return null;
}

interface Box {
  type: string;
  start: number;
  content: number;
  end: number;
}

async function boxes(bytes: Bytes, from: number, to: number): Promise<Box[]> {
  const out: Box[] = [];
  let pos = from;
  while (pos + 8 <= to && out.length < MAX_BOXES) {
    let head: Uint8Array;
    try {
      head = await bytes.at(pos, 8);
    } catch {
      break; // the end of the file
    }
    let size = u32be(head, 0);
    let content = pos + 8;
    if (size === 1) {
      const large = await bytes.at(pos + 8, 8);
      size = u32be(large, 0) * 2 ** 32 + u32be(large, 4);
      content = pos + 16;
    } else if (size === 0) size = to - pos;
    if (size < 8) break;
    out.push({ type: ascii(head, 4, 4), start: pos, content, end: pos + size });
    pos += size;
  }
  return out;
}

/** The EXIF orientation a HEIF rotation (quarter turns anticlockwise) and mirror give. */
function heifOrientation(turns: number, mirror: number | null): number {
  if (mirror === null) return [1, 8, 3, 6][turns];
  const flipped = (turns + (mirror === 1 ? 2 : 0)) % 4;
  return [2, 7, 4, 5][flipped];
}

async function isobmff(bytes: Bytes): Promise<Found> {
  const top = await boxes(bytes, 0, Number.MAX_SAFE_INTEGER);
  let found: Found = null;
  const meta = top.find((b) => b.type === "meta");
  if (meta) {
    const children = await boxes(bytes, meta.content + 4, meta.end);
    const pitm = children.find((b) => b.type === "pitm");
    const iprp = children.find((b) => b.type === "iprp");
    if (pitm && iprp) {
      const p = await bytes.at(pitm.content, 8);
      const primary = p[0] === 0 ? u16be(p, 4) : u32be(p, 4);
      const parts = await boxes(bytes, iprp.content, iprp.end);
      const ipco = parts.find((b) => b.type === "ipco");
      const ipma = parts.find((b) => b.type === "ipma");
      if (ipco && ipma) {
        const props = await boxes(bytes, ipco.content, ipco.end);
        const table = await bytes.at(ipma.content, ipma.end - ipma.content);
        const version = table[0];
        const wide = (table[3] & 1) === 1;
        let at = 4;
        const entries = u32be(table, at);
        at += 4;
        let associated: number[] = [];
        for (let e = 0; e < entries && at < table.length; e++) {
          const item = version < 1 ? u16be(table, at) : u32be(table, at);
          at += version < 1 ? 2 : 4;
          const n = table[at];
          at += 1;
          const list: number[] = [];
          for (let k = 0; k < n; k++) {
            list.push(wide ? u16be(table, at) & 0x7fff : table[at] & 0x7f);
            at += wide ? 2 : 1;
          }
          if (item === primary) associated = list;
        }
        let width = 0;
        let height = 0;
        let turns = 0;
        let mirror: number | null = null;
        for (const index of associated) {
          const prop = props[index - 1];
          if (!prop) continue;
          if (prop.type === "ispe") {
            const d = await bytes.at(prop.content, 12);
            width = u32be(d, 4);
            height = u32be(d, 8);
          } else if (prop.type === "irot") {
            turns = (await bytes.at(prop.content, 1))[0] & 3;
          } else if (prop.type === "imir") {
            mirror = (await bytes.at(prop.content, 1))[0] & 1;
          } else if (prop.type === "clap") {
            const d = await bytes.at(prop.content, 16);
            const w = u32be(d, 0) / Math.max(1, u32be(d, 4));
            const h = u32be(d, 8) / Math.max(1, u32be(d, 12));
            if (w > 0 && h > 0) {
              width = Math.floor(w);
              height = Math.floor(h);
            }
          }
        }
        if (width > 0 && height > 0)
          found = { width, height, orientation: heifOrientation(turns, mirror) };
      }
    }
  }
  const moov = top.find((b) => b.type === "moov");
  if (moov) {
    for (const trak of (await boxes(bytes, moov.content, moov.end)).filter(
      (b) => b.type === "trak",
    )) {
      const tkhd = (await boxes(bytes, trak.content, trak.end)).find((b) => b.type === "tkhd");
      if (!tkhd) continue;
      const v1 = (await bytes.at(tkhd.content, 1))[0] === 1;
      const at = v1 ? 88 : 76;
      const d = await bytes.at(tkhd.content, at + 8);
      const width = u32be(d, at) >>> 16;
      const height = u32be(d, at + 4) >>> 16;
      if (!found || width * height > found.width * found.height) {
        found = { width, height, orientation: found?.orientation ?? 1 };
      }
    }
  }
  return found;
}

async function jp2(bytes: Bytes): Promise<Found> {
  const top = await boxes(bytes, 0, Number.MAX_SAFE_INTEGER);
  const jp2h = top.find((b) => b.type === "jp2h");
  const jp2c = top.find((b) => b.type === "jp2c");
  if (!jp2h || !jp2c) return null;
  const ihdr = (await boxes(bytes, jp2h.content, jp2h.end)).find((b) => b.type === "ihdr");
  if (!ihdr) return null;
  const h = await bytes.at(ihdr.content, 8);
  const height = u32be(h, 0);
  const width = u32be(h, 4);
  const siz = await bytes.at(jp2c.content, 24);
  if (u16be(siz, 0) !== 0xff4f || u16be(siz, 2) !== 0xff51) return null;
  const codestreamWidth = u32be(siz, 8) - u32be(siz, 16);
  const codestreamHeight = u32be(siz, 12) - u32be(siz, 20);
  if (codestreamWidth !== width || codestreamHeight !== height) return null;
  return { width, height, orientation: 1 };
}

/** JPEG XL's SizeHeader and the orientation in the image metadata after it. */
function jxlCodestream(b: Uint8Array): Found {
  let bit = 16;
  const u = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++, bit++) {
      const byte = b[bit >> 3];
      if (byte === undefined) throw new Unreadable();
      v |= ((byte >> (bit & 7)) & 1) << i;
    }
    return v >>> 0;
  };
  const u32dist = () => [() => 1 + u(9), () => 1 + u(13), () => 1 + u(18), () => 1 + u(30)][u(2)]();
  const ratios = [null, [1, 1], [12, 10], [4, 3], [3, 2], [16, 9], [5, 4], [2, 1]] as const;
  let height: number;
  let width: number;
  if (u(1)) {
    height = (u(5) + 1) * 8;
    const ratio = u(3);
    width = ratio ? Math.floor((height * ratios[ratio]![0]) / ratios[ratio]![1]) : (u(5) + 1) * 8;
  } else {
    height = u32dist();
    const ratio = u(3);
    width = ratio ? Math.floor((height * ratios[ratio]![0]) / ratios[ratio]![1]) : u32dist();
  }
  let orientation = 1;
  const allDefault = u(1);
  if (!allDefault && u(1)) orientation = 1 + u(3);
  return { width, height, orientation };
}

async function jxl(bytes: Bytes): Promise<Found> {
  const head = await bytes.at(0, 2);
  if (head[0] === 0xff && head[1] === 0x0a) return jxlCodestream(await bytes.at(0, 32));
  for (const box of await boxes(bytes, 0, Number.MAX_SAFE_INTEGER)) {
    if (box.type === "jxlc") return jxlCodestream(await bytes.at(box.content, 32));
    if (box.type === "jxlp") return jxlCodestream(await bytes.at(box.content + 4, 32));
  }
  return null;
}

const READERS: Record<ImageKind, (bytes: Bytes) => Promise<Found>> = {
  png,
  jpeg,
  gif,
  bmp,
  webp,
  tiff,
  avif: isobmff,
  heic: isobmff,
  jp2,
  jxl,
};

const swaps = (orientation: number) => orientation >= 5;

/** The picture's kind, size and orientation from the bytes `read` gives. */
export async function imageHeader(read: Read): Promise<ImageHeader> {
  const bytes = new Bytes(read);
  let head: Uint8Array;
  try {
    head = await bytes.at(0, 64);
  } catch {
    try {
      head = await read(0, 64);
    } catch {
      return { kind: "unknown" };
    }
  }
  const kind = kindOf(head);
  if (!kind) return { kind: "unknown" };
  const found = await READERS[kind](bytes).catch((): Found => null);
  if (!found || !(found.width > 0) || !(found.height > 0)) return { kind, size: null };
  const size = { width: found.width, height: found.height };
  return {
    kind,
    size,
    orientation: found.orientation,
    oriented: swaps(found.orientation) ? { width: size.height, height: size.width } : size,
  };
}
