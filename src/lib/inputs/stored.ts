// Frames as IndexedDB keeps them. A stored frame names its bytes by cid; the
// bytes are separate records written once, because the browser copies every
// Blob in a record each time the record is put.

import { loose, type Loose } from "./loose";
import type { SizeSourcePick } from "./outline";
import type {
  ActiveItem,
  Frame,
  FrameRole,
  MaskObject,
  MaskStroke,
  MediaKind,
  Picture,
  Transform,
} from "./types";

/** Bumped when an older build could misread what a newer one stores. */
export const DOCUMENT_SCHEMA = 1;

export interface StoredPicture extends Omit<Picture, "file"> {
  /** The bytes were already unreadable when this was stored. */
  missing: boolean;
}

export type StoredMaskObject = Omit<MaskObject, "blob">;

export interface StoredFrame extends Omit<Frame, "pictures" | "mask"> {
  pictures: StoredPicture[];
  mask: { objects: StoredMaskObject[]; strokes: MaskStroke[] };
}

export interface SplitFrames {
  frames: StoredFrame[];
  /** Every Blob the frames hold, by cid. */
  blobs: Map<string, Blob>;
}

export function splitFrames(frames: Frame[]): SplitFrames {
  const blobs = new Map<string, Blob>();
  const stored = frames.map((frame): StoredFrame => {
    const pictures = frame.pictures.map(({ file, ...rest }): StoredPicture => {
      if (file) blobs.set(rest.cid, file);
      return { ...rest, missing: file === null };
    });
    const objects = frame.mask.objects.map(({ blob, ...rest }): StoredMaskObject => {
      blobs.set(rest.cid, blob);
      return rest;
    });
    return { ...frame, pictures, mask: { objects, strokes: frame.mask.strokes } };
  });
  return { frames: stored, blobs };
}

/** Content whose bytes were stored and are no longer there. */
export interface JoinLoss {
  pictures: { frameId: string; name: string }[];
  maskObjects: number;
}

/** Frames with their bytes back. A picture without bytes stays, unreadable; a
 * mask object without bytes is dropped. */
export function joinFrames(
  stored: StoredFrame[],
  blobs: ReadonlyMap<string, Blob>,
): { frames: Frame[]; lost: JoinLoss } {
  const lost: JoinLoss = { pictures: [], maskObjects: 0 };
  const frames = stored.map((frame): Frame => {
    const pictures = frame.pictures.map(({ missing, ...rest }): Picture => {
      const file = blobs.get(rest.cid) ?? null;
      if (!file && !missing) lost.pictures.push({ frameId: frame.id, name: rest.name });
      return { ...rest, file };
    });
    const objects = frame.mask.objects.flatMap((object): MaskObject[] => {
      const blob = blobs.get(object.cid);
      if (!blob) lost.maskObjects += 1;
      return blob ? [{ ...object, blob }] : [];
    });
    return { ...frame, pictures, mask: { objects, strokes: frame.mask.strokes } };
  });
  return { frames, lost };
}

/** Every cid the frames name, once each. */
export function namedCids(frames: StoredFrame[]): string[] {
  const cids = new Set<string>();
  for (const frame of frames) {
    for (const picture of frame.pictures) cids.add(picture.cid);
    for (const object of frame.mask.objects) cids.add(object.cid);
  }
  return [...cids];
}

/** Stored inputs hold something this build cannot account for. */
export class UnreadableDocument extends Error {
  override name = "UnreadableDocument";
}

/** Stored inputs were written by a build with a newer schema. */
export class NewerDocument extends Error {
  override name = "NewerDocument";
  readonly schema: number;
  constructor(schema: number) {
    super(`stored inputs: schema ${schema} is newer than ${DOCUMENT_SCHEMA}`);
    this.schema = schema;
  }
}

function fail(path: string): never {
  throw new UnreadableDocument(`stored inputs: unexpected value at ${path}`);
}

function fields<T>(value: unknown, path: string): Loose<T> {
  return loose<T>(value) ?? fail(path);
}

/** `read` with every key of `raw` accounted for. */
function exact<T extends object>(raw: Loose<T>, path: string, read: T): T {
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(read, key)) fail(`${path}.${key}`);
  }
  return read;
}

function list(value: unknown, path: string): unknown[] {
  return Array.isArray(value) ? value : fail(path);
}

function text(value: unknown, path: string): string {
  return typeof value === "string" ? value : fail(path);
}

function flag(value: unknown, path: string): boolean {
  return typeof value === "boolean" ? value : fail(path);
}

function num(value: unknown, path: string): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fail(path);
}

function oneOf<T extends string>(value: unknown, options: readonly T[], path: string): T {
  return options.find((option) => option === value) ?? fail(path);
}

const ROLES: readonly FrameRole[] = ["initial", "reference"];
const MEDIA: readonly MediaKind[] = ["image", "video", "audio"];
const TOOLS: readonly MaskStroke["tool"][] = ["brush", "eraser"];

function readTransform(value: unknown, path: string): Transform {
  const t = fields<Transform>(value, path);
  return exact(t, path, {
    x: num(t.x, `${path}.x`),
    y: num(t.y, `${path}.y`),
    scaleX: num(t.scaleX, `${path}.scaleX`),
    scaleY: num(t.scaleY, `${path}.scaleY`),
    rotation: num(t.rotation, `${path}.rotation`),
  });
}

function readPicture(value: unknown, path: string): StoredPicture {
  const p = fields<StoredPicture>(value, path);
  return exact(p, path, {
    id: text(p.id, `${path}.id`),
    cid: text(p.cid, `${path}.cid`),
    name: text(p.name, `${path}.name`),
    media: oneOf(p.media, MEDIA, `${path}.media`),
    width: num(p.width, `${path}.width`),
    height: num(p.height, `${path}.height`),
    visible: flag(p.visible, `${path}.visible`),
    hiddenBySwitch: flag(p.hiddenBySwitch, `${path}.hiddenBySwitch`),
    locked: flag(p.locked, `${path}.locked`),
    opacity: num(p.opacity, `${path}.opacity`),
    transform: p.transform === null ? null : readTransform(p.transform, `${path}.transform`),
    missing: flag(p.missing, `${path}.missing`),
  });
}

function readMaskObject(value: unknown, path: string): StoredMaskObject {
  const m = fields<StoredMaskObject>(value, path);
  return exact(m, path, {
    id: text(m.id, `${path}.id`),
    cid: text(m.cid, `${path}.cid`),
    name: text(m.name, `${path}.name`),
    visible: flag(m.visible, `${path}.visible`),
    locked: flag(m.locked, `${path}.locked`),
    width: num(m.width, `${path}.width`),
    height: num(m.height, `${path}.height`),
    transform: readTransform(m.transform, `${path}.transform`),
  });
}

function readStroke(value: unknown, path: string): MaskStroke {
  const s = fields<MaskStroke>(value, path);
  return exact(s, path, {
    points: list(s.points, `${path}.points`).map((v, i) => num(v, `${path}.points[${i}]`)),
    strokeWidth: num(s.strokeWidth, `${path}.strokeWidth`),
    tool: oneOf(s.tool, TOOLS, `${path}.tool`),
  });
}

function readFrame(value: unknown, path: string): StoredFrame {
  const f = fields<StoredFrame>(value, path);
  const mask = fields<StoredFrame["mask"]>(f.mask, `${path}.mask`);
  return exact(f, path, {
    id: text(f.id, `${path}.id`),
    role: oneOf(f.role, ROLES, `${path}.role`),
    enabled: flag(f.enabled, `${path}.enabled`),
    pictures: list(f.pictures, `${path}.pictures`).map((p, i) =>
      readPicture(p, `${path}.pictures[${i}]`),
    ),
    mask: exact(mask, `${path}.mask`, {
      objects: list(mask.objects, `${path}.mask.objects`).map((m, i) =>
        readMaskObject(m, `${path}.mask.objects[${i}]`),
      ),
      strokes: list(mask.strokes, `${path}.mask.strokes`).map((s, i) =>
        readStroke(s, `${path}.mask.strokes[${i}]`),
      ),
    }),
  });
}

/** Stored frames checked field by field. Throws on anything unexpected, a
 * field this build does not know included, so a record it cannot account for
 * is left as it is instead of being read in part and written back. */
export function readStoredFrames(value: unknown): StoredFrame[] {
  return list(value, "frames").map((f, i) => readFrame(f, `frames[${i}]`));
}

/** The inputs being worked on: the frames plus what the store keeps beside them. */
export interface WorkingDocument {
  frames: Frame[];
  selectedFrameId: string | null;
  activeItem: ActiveItem | null;
  sizeSource: SizeSourcePick | null;
  /** Fingerprint of each legacy record already brought in, by source. */
  imports: Record<string, string>;
}

export interface StoredWorking extends Omit<WorkingDocument, "frames"> {
  schema: number;
  /** Counts the writes of this document, so a tab can tell that another one
   * has written since it last read. */
  revision: number;
  frames: StoredFrame[];
}

export function splitWorking(
  doc: WorkingDocument,
  revision: number,
): {
  record: StoredWorking;
  blobs: Map<string, Blob>;
} {
  const { frames, blobs } = splitFrames(doc.frames);
  return {
    record: {
      schema: DOCUMENT_SCHEMA,
      revision,
      frames,
      selectedFrameId: doc.selectedFrameId,
      activeItem: doc.activeItem,
      sizeSource: doc.sizeSource,
      imports: doc.imports,
    },
    blobs,
  };
}

/** A stored working document checked field by field. Throws NewerDocument for
 * a schema this build does not know and UnreadableDocument for anything else
 * it cannot account for. */
export function readWorking(value: unknown): StoredWorking {
  const r = fields<StoredWorking>(value, "record");
  const schema = num(r.schema, "record.schema");
  if (schema > DOCUMENT_SCHEMA) throw new NewerDocument(schema);
  const orNull = <T>(raw: unknown, read: (raw: unknown) => T): T | null =>
    raw === null ? null : read(raw);
  const imports = fields<Record<string, string>>(r.imports, "record.imports");
  return exact(r, "record", {
    schema,
    revision: num(r.revision, "record.revision"),
    frames: readStoredFrames(r.frames),
    selectedFrameId: orNull(r.selectedFrameId, (raw) => text(raw, "record.selectedFrameId")),
    activeItem: orNull(r.activeItem, (raw) => {
      const item = fields<ActiveItem>(raw, "record.activeItem");
      return exact(item, "record.activeItem", {
        frameId: text(item.frameId, "record.activeItem.frameId"),
        id: text(item.id, "record.activeItem.id"),
      });
    }),
    sizeSource: orNull(r.sizeSource, (raw) => {
      const pick = fields<SizeSourcePick>(raw, "record.sizeSource");
      return exact(pick, "record.sizeSource", {
        frameId: text(pick.frameId, "record.sizeSource.frameId"),
        pictureId: orNull(pick.pictureId, (id) => text(id, "record.sizeSource.pictureId")),
      });
    }),
    imports: Object.fromEntries(
      Object.entries(imports).map(([source, mark]) => [
        source,
        text(mark, `record.imports.${source}`),
      ]),
    ),
  });
}

export function joinWorking(
  record: StoredWorking,
  blobs: ReadonlyMap<string, Blob>,
): { doc: WorkingDocument; lost: JoinLoss } {
  const { frames, lost } = joinFrames(record.frames, blobs);
  return {
    doc: {
      frames,
      selectedFrameId: record.selectedFrameId,
      activeItem: record.activeItem,
      sizeSource: record.sizeSource,
      imports: record.imports,
    },
    lost,
  };
}
