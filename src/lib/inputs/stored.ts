// Frames as IndexedDB keeps them. A stored frame names its bytes by cid; the
// bytes are separate records written once, because the browser copies every
// Blob in a record each time the record is put.

import { loose, type Loose } from "./loose";
import type { SizeSourcePick } from "./outline";
import type {
  ActiveItem,
  ControlSettings,
  ControlType,
  FitPolicy,
  Frame,
  FrameRole,
  IpAdapterSettings,
  JsonValue,
  MaskObject,
  MaskStroke,
  MediaKind,
  Picture,
  ProcessedPreview,
  Size,
  Transform,
} from "./types";

/** Bumped when an older build could misread what a newer one stores. Schema 1
 * frames had no fit, link, control, IP-Adapter or processed fields. */
export const DOCUMENT_SCHEMA = 2;

export interface StoredPicture extends Omit<Picture, "file"> {
  /** The bytes were already unreadable when this was stored. */
  missing: boolean;
}

export type StoredMaskObject = Omit<MaskObject, "blob">;

export interface StoredProcessed extends Omit<ProcessedPreview, "blob"> {
  missing: boolean;
}

export interface StoredIpAdapter extends Omit<IpAdapterSettings, "masks"> {
  masks: StoredPicture[];
}

export interface StoredFrame extends Omit<Frame, "pictures" | "mask" | "ipAdapter" | "processed"> {
  pictures: StoredPicture[];
  mask: { objects: StoredMaskObject[]; strokes: MaskStroke[] };
  ipAdapter: StoredIpAdapter;
  processed: StoredProcessed | null;
}

export interface SplitFrames {
  frames: StoredFrame[];
  /** Every Blob the frames hold, by cid. */
  blobs: Map<string, Blob>;
}

export function splitFrames(frames: Frame[]): SplitFrames {
  const blobs = new Map<string, Blob>();
  const picture = ({ file, ...rest }: Picture): StoredPicture => {
    if (file) blobs.set(rest.cid, file);
    return { ...rest, missing: file === null };
  };
  const stored = frames.map((frame): StoredFrame => {
    const objects = frame.mask.objects.map(({ blob, ...rest }): StoredMaskObject => {
      blobs.set(rest.cid, blob);
      return rest;
    });
    let processed: StoredProcessed | null = null;
    if (frame.processed) {
      const { blob, ...rest } = frame.processed;
      if (blob) blobs.set(rest.cid, blob);
      processed = { ...rest, missing: blob === null };
    }
    return {
      ...frame,
      pictures: frame.pictures.map(picture),
      mask: { objects, strokes: frame.mask.strokes },
      ipAdapter: { ...frame.ipAdapter, masks: frame.ipAdapter.masks.map(picture) },
      processed,
    };
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
    const picture = ({ missing, ...rest }: StoredPicture): Picture => {
      const file = blobs.get(rest.cid) ?? null;
      if (!file && !missing) lost.pictures.push({ frameId: frame.id, name: rest.name });
      return { ...rest, file };
    };
    const objects = frame.mask.objects.flatMap((object): MaskObject[] => {
      const blob = blobs.get(object.cid);
      if (!blob) lost.maskObjects += 1;
      return blob ? [{ ...object, blob }] : [];
    });
    let processed: ProcessedPreview | null = null;
    if (frame.processed) {
      const { missing, ...rest } = frame.processed;
      const blob = blobs.get(rest.cid) ?? null;
      if (!blob && !missing) lost.pictures.push({ frameId: frame.id, name: "Processed map" });
      processed = { ...rest, blob };
    }
    return {
      ...frame,
      pictures: frame.pictures.map(picture),
      mask: { objects, strokes: frame.mask.strokes },
      ipAdapter: { ...frame.ipAdapter, masks: frame.ipAdapter.masks.map(picture) },
      processed,
    };
  });
  return { frames, lost };
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

function orNull<T>(raw: unknown, read: (raw: unknown) => T): T | null {
  return raw === null ? null : read(raw);
}

function json(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return num(value, path);
  if (Array.isArray(value)) return value.map((v, i) => json(v, `${path}[${i}]`));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, json(v, `${path}.${key}`)]),
    );
  }
  return fail(path);
}

const ROLES: readonly FrameRole[] = ["initial", "reference", "control", "ipAdapter"];
const MEDIA: readonly MediaKind[] = ["image", "video", "audio"];
const TOOLS: readonly MaskStroke["tool"][] = ["brush", "eraser"];
const FITS: readonly FitPolicy[] = ["contain", "cover", "fill"];
const CONTROL_TYPES: readonly ControlType[] = ["controlnet", "t2i", "xs", "lite", "style_transfer"];

const CONTROL_DEFAULTS: ControlSettings = {
  type: "controlnet",
  model: "None",
  mode: "default",
  strength: 1,
  start: 0,
  end: 1,
  guess: false,
  factor: 1,
  attention: "Attention",
  fidelity: 0.5,
  queryWeight: 1,
  adainWeight: 1,
  process: "None",
  processParams: {},
};

const IP_ADAPTER_DEFAULTS: StoredIpAdapter = {
  adapter: "None",
  scale: 0.5,
  crop: false,
  start: 0,
  end: 1,
  masks: [],
};

/** Reads stored frames field by field and keeps every cid it accepts, so a
 * field cannot be read without counting as a reference to its bytes. Frames
 * from schema 1 take the defaults for the fields that came later. */
class FrameReader {
  readonly cids = new Set<string>();
  private readonly schema: number;

  constructor(schema: number) {
    this.schema = schema;
  }

  private get upgrading(): boolean {
    return this.schema < 2;
  }

  transform(value: unknown, path: string): Transform {
    const t = fields<Transform>(value, path);
    return exact(t, path, {
      x: num(t.x, `${path}.x`),
      y: num(t.y, `${path}.y`),
      scaleX: num(t.scaleX, `${path}.scaleX`),
      scaleY: num(t.scaleY, `${path}.scaleY`),
      rotation: num(t.rotation, `${path}.rotation`),
    });
  }

  picture(value: unknown, path: string): StoredPicture {
    const p = fields<StoredPicture>(value, path);
    const cid = text(p.cid, `${path}.cid`);
    this.cids.add(cid);
    return exact(p, path, {
      id: text(p.id, `${path}.id`),
      cid,
      name: text(p.name, `${path}.name`),
      media: oneOf(p.media, MEDIA, `${path}.media`),
      width: num(p.width, `${path}.width`),
      height: num(p.height, `${path}.height`),
      visible: flag(p.visible, `${path}.visible`),
      hiddenBySwitch: flag(p.hiddenBySwitch, `${path}.hiddenBySwitch`),
      locked: flag(p.locked, `${path}.locked`),
      opacity: num(p.opacity, `${path}.opacity`),
      transform: orNull(p.transform, (raw) => this.transform(raw, `${path}.transform`)),
      missing: flag(p.missing, `${path}.missing`),
    });
  }

  maskObject(value: unknown, path: string): StoredMaskObject {
    const m = fields<StoredMaskObject>(value, path);
    const cid = text(m.cid, `${path}.cid`);
    this.cids.add(cid);
    return exact(m, path, {
      id: text(m.id, `${path}.id`),
      cid,
      name: text(m.name, `${path}.name`),
      visible: flag(m.visible, `${path}.visible`),
      locked: flag(m.locked, `${path}.locked`),
      width: num(m.width, `${path}.width`),
      height: num(m.height, `${path}.height`),
      transform: this.transform(m.transform, `${path}.transform`),
    });
  }

  stroke(value: unknown, path: string): MaskStroke {
    const s = fields<MaskStroke>(value, path);
    return exact(s, path, {
      points: list(s.points, `${path}.points`).map((v, i) => num(v, `${path}.points[${i}]`)),
      strokeWidth: num(s.strokeWidth, `${path}.strokeWidth`),
      tool: oneOf(s.tool, TOOLS, `${path}.tool`),
    });
  }

  control(value: unknown, path: string): ControlSettings {
    if (value === undefined && this.upgrading) return { ...CONTROL_DEFAULTS };
    const c = fields<ControlSettings>(value, path);
    const params = fields<Record<string, JsonValue>>(c.processParams, `${path}.processParams`);
    return exact(c, path, {
      type: oneOf(c.type, CONTROL_TYPES, `${path}.type`),
      model: text(c.model, `${path}.model`),
      mode: text(c.mode, `${path}.mode`),
      strength: num(c.strength, `${path}.strength`),
      start: num(c.start, `${path}.start`),
      end: num(c.end, `${path}.end`),
      guess: flag(c.guess, `${path}.guess`),
      factor: num(c.factor, `${path}.factor`),
      attention: text(c.attention, `${path}.attention`),
      fidelity: num(c.fidelity, `${path}.fidelity`),
      queryWeight: num(c.queryWeight, `${path}.queryWeight`),
      adainWeight: num(c.adainWeight, `${path}.adainWeight`),
      process: text(c.process, `${path}.process`),
      processParams: Object.fromEntries(
        Object.entries(params).map(([key, v]) => [key, json(v, `${path}.processParams.${key}`)]),
      ),
    });
  }

  ipAdapter(value: unknown, path: string): StoredIpAdapter {
    if (value === undefined && this.upgrading) return { ...IP_ADAPTER_DEFAULTS, masks: [] };
    const a = fields<StoredIpAdapter>(value, path);
    return exact(a, path, {
      adapter: text(a.adapter, `${path}.adapter`),
      scale: num(a.scale, `${path}.scale`),
      crop: flag(a.crop, `${path}.crop`),
      start: num(a.start, `${path}.start`),
      end: num(a.end, `${path}.end`),
      masks: list(a.masks, `${path}.masks`).map((m, i) => this.picture(m, `${path}.masks[${i}]`)),
    });
  }

  processed(value: unknown, path: string): StoredProcessed | null {
    if (value === undefined && this.upgrading) return null;
    return orNull(value, (raw) => {
      const p = fields<StoredProcessed>(raw, path);
      const cid = text(p.cid, `${path}.cid`);
      this.cids.add(cid);
      return exact(p, path, {
        cid,
        width: num(p.width, `${path}.width`),
        height: num(p.height, `${path}.height`),
        missing: flag(p.missing, `${path}.missing`),
      });
    });
  }

  frame(value: unknown, path: string): StoredFrame {
    const f = fields<StoredFrame>(value, path);
    const mask = fields<StoredFrame["mask"]>(f.mask, `${path}.mask`);
    const later = <T>(raw: unknown, fallback: T, read: (raw: unknown) => T): T =>
      raw === undefined && this.upgrading ? fallback : read(raw);
    return exact(f, path, {
      id: text(f.id, `${path}.id`),
      role: oneOf(f.role, ROLES, `${path}.role`),
      enabled: flag(f.enabled, `${path}.enabled`),
      pictures: list(f.pictures, `${path}.pictures`).map((p, i) =>
        this.picture(p, `${path}.pictures[${i}]`),
      ),
      mask: exact(mask, `${path}.mask`, {
        objects: list(mask.objects, `${path}.mask.objects`).map((m, i) =>
          this.maskObject(m, `${path}.mask.objects[${i}]`),
        ),
        strokes: list(mask.strokes, `${path}.mask.strokes`).map((s, i) =>
          this.stroke(s, `${path}.mask.strokes[${i}]`),
        ),
      }),
      fit: later(f.fit, null, (raw) => orNull(raw, (v) => oneOf(v, FITS, `${path}.fit`))),
      link: later(f.link, null, (raw) =>
        orNull(raw, (v) => {
          const link = fields<{ frameId: string }>(v, `${path}.link`);
          return exact(link, `${path}.link`, {
            frameId: text(link.frameId, `${path}.link.frameId`),
          });
        }),
      ),
      control: this.control(f.control, `${path}.control`),
      ipAdapter: this.ipAdapter(f.ipAdapter, `${path}.ipAdapter`),
      processed: this.processed(f.processed, `${path}.processed`),
    });
  }
}

export interface ReadFrames {
  frames: StoredFrame[];
  /** Every cid the frames name, once each. */
  cids: string[];
}

/** Stored frames checked field by field. Throws on anything unexpected, a
 * field this build does not know included, so a record it cannot account for
 * is left as it is instead of being read in part and written back. */
export function readStoredFrames(value: unknown, schema = DOCUMENT_SCHEMA): ReadFrames {
  const reader = new FrameReader(schema);
  const frames = list(value, "frames").map((f, i) => reader.frame(f, `frames[${i}]`));
  return { frames, cids: [...reader.cids] };
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

export interface ReadWorking {
  record: StoredWorking;
  /** Every cid the record names, once each. */
  cids: string[];
}

/** A stored working document checked field by field. Throws NewerDocument for
 * a schema this build does not know and UnreadableDocument for anything else
 * it cannot account for. A schema 1 record reads as schema 2 with defaults. */
export function readWorking(value: unknown): ReadWorking {
  const r = fields<StoredWorking>(value, "record");
  const schema = num(r.schema, "record.schema");
  if (schema > DOCUMENT_SCHEMA) throw new NewerDocument(schema);
  const imports = fields<Record<string, string>>(r.imports, "record.imports");
  const { frames, cids } = readStoredFrames(r.frames, schema);
  const record = exact(r, "record", {
    schema: DOCUMENT_SCHEMA,
    revision: num(r.revision, "record.revision"),
    frames,
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
  return { record, cids };
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

/** The frames as a job sent them, with the frame size their placements are in. */
export interface StoredSnapshot {
  schema: number;
  size: Size;
  frames: StoredFrame[];
}

export function splitSnapshot(
  frames: Frame[],
  size: Size,
): { record: StoredSnapshot; blobs: Map<string, Blob> } {
  const split = splitFrames(frames);
  return {
    record: { schema: DOCUMENT_SCHEMA, size: { ...size }, frames: split.frames },
    blobs: split.blobs,
  };
}

export interface ReadSnapshot {
  record: StoredSnapshot;
  cids: string[];
}

/** A stored snapshot checked like the working document. */
export function readSnapshot(value: unknown): ReadSnapshot {
  const r = fields<StoredSnapshot>(value, "snapshot");
  const schema = num(r.schema, "snapshot.schema");
  if (schema > DOCUMENT_SCHEMA) throw new NewerDocument(schema);
  const size = fields<Size>(r.size, "snapshot.size");
  const { frames, cids } = readStoredFrames(r.frames, schema);
  const record = exact(r, "snapshot", {
    schema: DOCUMENT_SCHEMA,
    size: exact(size, "snapshot.size", {
      width: num(size.width, "snapshot.size.width"),
      height: num(size.height, "snapshot.size.height"),
    }),
    frames,
  });
  return { record, cids };
}

export function joinSnapshot(
  record: StoredSnapshot,
  blobs: ReadonlyMap<string, Blob>,
): { frames: Frame[]; size: Size; lost: JoinLoss } {
  const { frames, lost } = joinFrames(record.frames, blobs);
  return { frames, size: record.size, lost };
}
