// Frames as IndexedDB keeps them. A stored frame names its bytes by cid; the
// bytes are separate records written once, because the browser copies every
// Blob in a record each time the record is put.

import type { JobDomain } from "@/lib/jobs/domains";
import { refsIn } from "@/lib/jobs/replay";
import type { ImportNote } from "./legacy";
import { loose, type Loose } from "./loose";
import type { SizeSourcePick } from "./outline";
import {
  cidsOf,
  type ActiveItem,
  type ControlSettings,
  type ControlType,
  type FitPolicy,
  type Frame,
  type FrameRole,
  type IpAdapterSettings,
  type JsonValue,
  type MaskObject,
  type MaskStroke,
  type MediaKind,
  type Picture,
  type ProcessorSpec,
  type Size,
  type Transform,
} from "./types";

/** Bumped when an older build could misread what a newer one stores. Schema 1
 * frames had no fit, link, control or IP-Adapter fields; schema 2 kept the
 * processor inside the control settings and a processed preview per frame. */
export const DOCUMENT_SCHEMA = 3;

export interface StoredPicture extends Omit<Picture, "file"> {
  /** The bytes were already unreadable when this was stored. */
  missing: boolean;
}

export type StoredMaskObject = Omit<MaskObject, "blob">;

export interface StoredIpAdapter extends Omit<IpAdapterSettings, "masks"> {
  masks: StoredPicture[];
}

export interface StoredFrame extends Omit<Frame, "pictures" | "mask" | "ipAdapter"> {
  pictures: StoredPicture[];
  mask: { objects: StoredMaskObject[]; strokes: MaskStroke[] };
  ipAdapter: StoredIpAdapter;
}

export interface SplitFrames {
  frames: StoredFrame[];
  /** Every Blob the frames hold, by cid. */
  blobs: Map<string, Blob>;
}

/** A picture's stored form, its bytes put aside in `blobs`. */
function storing(blobs: Map<string, Blob>) {
  return ({ file, ...rest }: Picture): StoredPicture => {
    if (file) blobs.set(rest.cid, file);
    return { ...rest, missing: file === null };
  };
}

function splitInto(frames: Frame[], blobs: Map<string, Blob>): StoredFrame[] {
  const picture = storing(blobs);
  return frames.map((frame): StoredFrame => {
    const objects = frame.mask.objects.map(({ blob, ...rest }): StoredMaskObject => {
      blobs.set(rest.cid, blob);
      return rest;
    });
    return {
      ...frame,
      pictures: frame.pictures.map(picture),
      mask: { objects, strokes: frame.mask.strokes },
      ipAdapter: { ...frame.ipAdapter, masks: frame.ipAdapter.masks.map(picture) },
    };
  });
}

export function splitFrames(frames: Frame[]): SplitFrames {
  const blobs = new Map<string, Blob>();
  return { frames: splitInto(frames, blobs), blobs };
}

/** Content whose bytes were stored and are no longer there. */
export interface JoinLoss {
  pictures: { frameId: string; name: string }[];
  maskObjects: number;
}

/** Frames with their bytes back. A picture without bytes stays, unreadable; a
 * mask object without bytes is dropped. */
/** A stored picture with its bytes back; one whose bytes are gone is noted in `lost`. */
function joining(blobs: ReadonlyMap<string, Blob>, lost: JoinLoss, frameId: string) {
  return ({ missing, ...rest }: StoredPicture): Picture => {
    const file = blobs.get(rest.cid) ?? null;
    if (!file && !missing) lost.pictures.push({ frameId, name: rest.name });
    return { ...rest, file };
  };
}

function joinInto(
  stored: StoredFrame[],
  blobs: ReadonlyMap<string, Blob>,
  lost: JoinLoss,
): Frame[] {
  return stored.map((frame): Frame => {
    const picture = joining(blobs, lost, frame.id);
    const objects = frame.mask.objects.flatMap((object): MaskObject[] => {
      const blob = blobs.get(object.cid);
      if (!blob) lost.maskObjects += 1;
      return blob ? [{ ...object, blob }] : [];
    });
    return {
      ...frame,
      pictures: frame.pictures.map(picture),
      mask: { objects, strokes: frame.mask.strokes },
      ipAdapter: { ...frame.ipAdapter, masks: frame.ipAdapter.masks.map(picture) },
    };
  });
}

export function joinFrames(
  stored: StoredFrame[],
  blobs: ReadonlyMap<string, Blob>,
): { frames: Frame[]; lost: JoinLoss } {
  const lost: JoinLoss = { pictures: [], maskObjects: 0 };
  return { frames: joinInto(stored, blobs, lost), lost };
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
 * from an older schema take the defaults for the fields that came later, and
 * the fields that left are read and dropped. */
class FrameReader {
  readonly cids = new Set<string>();
  /** What an upgrade from an older schema dropped, for the load report. */
  readonly notes: ImportNote[] = [];
  private readonly schema: number;

  constructor(schema: number) {
    this.schema = schema;
  }

  /** The record predates `schema`. */
  private before(schema: number): boolean {
    return this.schema < schema;
  }

  private get upgrading(): boolean {
    return this.before(2);
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

  params(value: unknown, path: string): Record<string, JsonValue> {
    const params = fields<Record<string, JsonValue>>(value, path);
    return Object.fromEntries(
      Object.entries(params).map(([key, v]) => [key, json(v, `${path}.${key}`)]),
    );
  }

  /** The control settings, plus the processor schema 2 kept inside them. */
  control(
    value: unknown,
    path: string,
  ): { control: ControlSettings; processor: ProcessorSpec | null } {
    if (value === undefined && this.upgrading)
      return { control: { ...CONTROL_DEFAULTS }, processor: null };
    type Schema2 = ControlSettings & { process: string; processParams: Record<string, JsonValue> };
    const c = fields<Schema2>(value, path);
    const settings: ControlSettings = {
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
    };
    if (!this.before(3)) return { control: exact(c, path, settings), processor: null };
    const id = text(c.process, `${path}.process`);
    const params = this.params(c.processParams, `${path}.processParams`);
    exact(c, path, { ...settings, process: id, processParams: params });
    return { control: settings, processor: id === "None" ? null : { id, params } };
  }

  processor(value: unknown, path: string): ProcessorSpec | null {
    return orNull(value, (raw) => {
      const p = fields<ProcessorSpec>(raw, path);
      return exact(p, path, {
        id: text(p.id, `${path}.id`),
        params: this.params(p.params, `${path}.params`),
      });
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

  /** Schema 2's processed preview: read for its shape and dropped. Its bytes
   * are not named, so the sweep lets them go. True when there was one. */
  private dropPreview(value: unknown, path: string): boolean {
    const preview = orNull(value, (raw) => {
      const p = fields<{ cid: string; width: number; height: number; missing: boolean }>(raw, path);
      return exact(p, path, {
        cid: text(p.cid, `${path}.cid`),
        width: num(p.width, `${path}.width`),
        height: num(p.height, `${path}.height`),
        missing: flag(p.missing, `${path}.missing`),
      });
    });
    return preview !== null;
  }

  /** `position` is the frame's place in its list, for the notes an upgrade leaves. */
  frame(value: unknown, path: string, position = 0): StoredFrame {
    type Schema2 = StoredFrame & { processed: unknown };
    const f = fields<Schema2>(value, path);
    const mask = fields<StoredFrame["mask"]>(f.mask, `${path}.mask`);
    const later = <T>(raw: unknown, fallback: T, read: (raw: unknown) => T): T =>
      raw === undefined && this.upgrading ? fallback : read(raw);
    const { control, processor: fromControl } = this.control(f.control, `${path}.control`);
    const read: StoredFrame = {
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
      control,
      ipAdapter: this.ipAdapter(f.ipAdapter, `${path}.ipAdapter`),
      processor: this.before(3) ? null : this.processor(f.processor, `${path}.processor`),
    };
    if (!this.before(3)) return exact(f, path, read);
    // Schema 2 ran a frame's processor only while it was a Control frame
    if (fromControl && read.role === "control") read.processor = fromControl;
    else if (fromControl) {
      this.notes.push({ kind: "processorDropped", position, processor: fromControl.id });
    }
    if (f.processed !== undefined && this.dropPreview(f.processed, `${path}.processed`)) {
      this.notes.push({ kind: "previewDropped", position });
    }
    exact(f, path, { ...read, processed: null });
    return read;
  }
}

export interface ReadFrames {
  frames: StoredFrame[];
  /** Every cid the frames name, once each. */
  cids: string[];
  /** What reading frames of an older schema dropped. */
  notes: ImportNote[];
}

/** Stored frames checked field by field. Throws on anything unexpected, a
 * field this build does not know included, so a record it cannot account for
 * is left as it is instead of being read in part and written back. */
export function readStoredFrames(value: unknown, schema = DOCUMENT_SCHEMA): ReadFrames {
  const reader = new FrameReader(schema);
  const frames = list(value, "frames").map((f, i) => reader.frame(f, `frames[${i}]`, i + 1));
  return { frames, cids: [...reader.cids], notes: reader.notes };
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
  /** What reading a record of an older schema dropped, for the load report. */
  notes: ImportNote[];
}

/** A stored working document checked field by field. Throws NewerDocument for
 * a schema this build does not know and UnreadableDocument for anything else
 * it cannot account for. An older record reads as the current schema, with
 * defaults for the fields that came later. */
export function readWorking(value: unknown): ReadWorking {
  const r = fields<StoredWorking>(value, "record");
  const schema = num(r.schema, "record.schema");
  if (schema > DOCUMENT_SCHEMA) throw new NewerDocument(schema);
  const imports = fields<Record<string, string>>(r.imports, "record.imports");
  const { frames, cids, notes } = readStoredFrames(r.frames, schema);
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
    sizeSource: orNull(r.sizeSource, (raw) => sizePick(raw, "record.sizeSource")),
    imports: Object.fromEntries(
      Object.entries(imports).map(([source, mark]) => [
        source,
        text(mark, `record.imports.${source}`),
      ]),
    ),
  });
  return { record, cids, notes };
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

/** What a user action took out of the inputs, kept so it can be brought back:
 * a whole frame at its place in the list, a frame as it was before it was
 * emptied or replaced, one picture at its place in a frame, or the whole
 * list. `linkedFrom` names the Control frames that used a removed frame's
 * picture; `sizeSource` is the list's Size from pick. */
export type RemovalContent<F, P> =
  | { kind: "frame"; index: number; frame: F; linkedFrom: string[] }
  | { kind: "contents"; frame: F }
  | { kind: "picture"; index: number; picture: P }
  | { kind: "frames"; frames: F[]; sizeSource: SizeSourcePick | null };

/** Why it left: removed, emptied out of a frame or list that stays, or
 * replaced by a map, a picture, a restore or a recall. */
export type RemovalCause = "removed" | "cleared" | "replaced";

const CAUSES: readonly RemovalCause[] = ["removed", "cleared", "replaced"];

export interface Removal {
  removedAt: number;
  cause: RemovalCause;
  /** The frame size its placements are in; null when it was not recorded. */
  size: Size | null;
  /** The "Input N" it came from, and that frame's id. */
  from: { position: number; frameId: string; role: FrameRole };
  content: RemovalContent<Frame, Picture>;
}

/** Every cid a removal holds. */
export function removalCids({ content }: Removal): string[] {
  switch (content.kind) {
    case "picture":
      return [content.picture.cid];
    case "frames":
      return cidsOf(content.frames);
    default:
      return cidsOf([content.frame]);
  }
}

export interface StoredRemoval extends Omit<Removal, "content"> {
  schema: number;
  content: RemovalContent<StoredFrame, StoredPicture>;
}

export function splitRemoval(removal: Removal): {
  record: StoredRemoval;
  blobs: Map<string, Blob>;
} {
  const blobs = new Map<string, Blob>();
  const { content } = removal;
  let stored: StoredRemoval["content"];
  switch (content.kind) {
    case "frame":
      stored = { ...content, frame: splitInto([content.frame], blobs)[0] };
      break;
    case "contents":
      stored = { kind: "contents", frame: splitInto([content.frame], blobs)[0] };
      break;
    case "picture":
      stored = { ...content, picture: storing(blobs)(content.picture) };
      break;
    case "frames":
      stored = {
        kind: "frames",
        frames: splitInto(content.frames, blobs),
        sizeSource: content.sizeSource && { ...content.sizeSource },
      };
      break;
  }
  return {
    record: {
      schema: DOCUMENT_SCHEMA,
      removedAt: removal.removedAt,
      cause: removal.cause,
      size: removal.size && { ...removal.size },
      from: { ...removal.from },
      content: stored,
    },
    blobs,
  };
}

export interface ReadRemoval {
  record: StoredRemoval;
  cids: string[];
}

/** The cause of a record kept before causes were: what each kind was written for then. */
const KIND_CAUSE: Record<RemovalContent<never, never>["kind"], RemovalCause> = {
  frame: "removed",
  contents: "cleared",
  picture: "removed",
  frames: "cleared",
};
const REMOVAL_KINDS = Object.keys(KIND_CAUSE) as RemovalContent<never, never>["kind"][];

/** A stored removal checked like the working document. */
export function readRemoval(value: unknown): ReadRemoval {
  const r = fields<StoredRemoval>(value, "removal");
  const schema = num(r.schema, "removal.schema");
  if (schema > DOCUMENT_SCHEMA) throw new NewerDocument(schema);
  const reader = new FrameReader(schema);
  const from = fields<StoredRemoval["from"]>(r.from, "removal.from");
  const c = fields<StoredRemoval["content"]>(r.content, "removal.content");
  const kind = oneOf(c.kind, REMOVAL_KINDS, "removal.content.kind");
  let content: StoredRemoval["content"];
  if (kind === "frame") {
    const raw = c as Loose<Extract<StoredRemoval["content"], { kind: "frame" }>>;
    content = exact(raw, "removal.content", {
      kind,
      index: num(raw.index, "removal.content.index"),
      frame: reader.frame(raw.frame, "removal.content.frame"),
      linkedFrom: list(raw.linkedFrom, "removal.content.linkedFrom").map((id, i) =>
        text(id, `removal.content.linkedFrom[${i}]`),
      ),
    });
  } else if (kind === "contents") {
    const raw = c as Loose<Extract<StoredRemoval["content"], { kind: "contents" }>>;
    content = exact(raw, "removal.content", {
      kind,
      frame: reader.frame(raw.frame, "removal.content.frame"),
    });
  } else if (kind === "picture") {
    const raw = c as Loose<Extract<StoredRemoval["content"], { kind: "picture" }>>;
    content = exact(raw, "removal.content", {
      kind,
      index: num(raw.index, "removal.content.index"),
      picture: reader.picture(raw.picture, "removal.content.picture"),
    });
  } else {
    const raw = c as Loose<Extract<StoredRemoval["content"], { kind: "frames" }>>;
    content = exact(raw, "removal.content", {
      kind,
      frames: list(raw.frames, "removal.content.frames").map((f, i) =>
        reader.frame(f, `removal.content.frames[${i}]`),
      ),
      sizeSource:
        raw.sizeSource === undefined
          ? null
          : orNull(raw.sizeSource, (pick) => sizePick(pick, "removal.content.sizeSource")),
    });
  }
  const record = exact(r, "removal", {
    schema: DOCUMENT_SCHEMA,
    removedAt: num(r.removedAt, "removal.removedAt"),
    cause: r.cause === undefined ? KIND_CAUSE[kind] : oneOf(r.cause, CAUSES, "removal.cause"),
    size: r.size === undefined ? null : orNull(r.size, (raw) => size(raw, "removal.size")),
    from: exact(from, "removal.from", {
      position: num(from.position, "removal.from.position"),
      frameId: text(from.frameId, "removal.from.frameId"),
      role: oneOf(from.role, ROLES, "removal.from.role"),
    }),
    content,
  });
  return { record, cids: [...reader.cids] };
}

export function joinRemoval(
  record: StoredRemoval,
  blobs: ReadonlyMap<string, Blob>,
): { removal: Removal; lost: JoinLoss } {
  const lost: JoinLoss = { pictures: [], maskObjects: 0 };
  const { content } = record;
  let joined: Removal["content"];
  switch (content.kind) {
    case "frame":
      joined = { ...content, frame: joinInto([content.frame], blobs, lost)[0] };
      break;
    case "contents":
      joined = { kind: "contents", frame: joinInto([content.frame], blobs, lost)[0] };
      break;
    case "picture":
      joined = { ...content, picture: joining(blobs, lost, record.from.frameId)(content.picture) };
      break;
    case "frames":
      joined = {
        kind: "frames",
        frames: joinInto(content.frames, blobs, lost),
        sizeSource: content.sizeSource,
      };
      break;
  }
  return {
    removal: {
      removedAt: record.removedAt,
      cause: record.cause,
      size: record.size,
      from: { ...record.from },
      content: joined,
    },
    lost,
  };
}

/** A cached map: the record names the map's bytes by cid like any document,
 * and expires a retention period after the map was last used. */
export interface StoredMap {
  schema: number;
  /** The key the map answers to (freshness.ts). */
  key: string;
  cid: string;
  width: number;
  height: number;
  madeAt: number;
  usedAt: number;
}

export const MAP_SCHEMA = 1;

export interface ReadMap {
  record: StoredMap;
  cids: string[];
}

/** A stored map record checked field by field. */
export function readMap(value: unknown): ReadMap {
  const m = fields<StoredMap>(value, "map");
  const schema = num(m.schema, "map.schema");
  if (schema > MAP_SCHEMA) throw new NewerDocument(schema);
  const record = exact(m, "map", {
    schema: MAP_SCHEMA,
    key: text(m.key, "map.key"),
    cid: text(m.cid, "map.cid"),
    width: num(m.width, "map.width"),
    height: num(m.height, "map.height"),
    madeAt: num(m.madeAt, "map.madeAt"),
    usedAt: num(m.usedAt, "map.usedAt"),
  });
  return { record, cids: [record.cid] };
}

/** The limits a cloud provider takes pictures in, which the picture is
 * encoded to before it goes out. */
export interface ProviderEncoding {
  provider: string;
  model: string;
}

/** Where an upload a job sent came from, so the same picture can be made
 * again: a composed frame's pictures drawn at a size, a picture's file, a
 * frame's mask drawn at a size, an IP-Adapter region mask, or a map. A
 * composite or a map sent to a cloud model is also encoded for it. */
export type Source =
  | { kind: "composite"; frameId: string; drawnAt: Size; encode: ProviderEncoding | null }
  | { kind: "file"; frameId: string; pictureId: string }
  | { kind: "mask"; frameId: string; drawnAt: Size }
  | { kind: "ipMask"; frameId: string; maskId: string }
  | { kind: "map"; key: string; drawnAt: Size | null; encode: ProviderEncoding | null };

/** The frames a job was built from, the frame size their placements are in
 * and the Size from pick. `schema` is the frames' document schema. */
export interface StoredInputs {
  schema: number;
  size: Size;
  sizeSource: SizeSourcePick | null;
  frames: StoredFrame[];
}

export const JOB_SCHEMA = 1;

/** What this browser keeps of a job it sent, under the server's job id. */
export interface StoredJob {
  schema: number;
  id: string;
  domain: JobDomain;
  createdAt: number;
  /** The model it went to: sdnext's title, and the name shown for it. */
  checkpoint: { title: string; name: string } | null;
  /** The request as posted, its upload refs inside. */
  request: Record<string, JsonValue>;
  /** Where each upload ref the request names came from. */
  refs: Record<string, Source>;
  inputs: StoredInputs | null;
  /** The maps the job makes before generating. */
  mapKeys: string[];
  /** The cid of each map the job sent as a picture, by key. */
  maps: Record<string, string>;
  /** Its result has reached the strip, or never will. */
  routed: boolean;
}

/** Frames with their bytes, the frame size their placements are in and the
 * Size from pick: what a job was built from, or what a library entry holds. */
export interface Inputs {
  size: Size;
  sizeSource: SizeSourcePick | null;
  frames: Frame[];
}

export interface JobRecord extends Omit<StoredJob, "schema" | "request" | "refs" | "inputs"> {
  request: object;
  refs: Readonly<Record<string, Source>>;
  /** The frames with their bytes, or as another record stored them. */
  inputs: Inputs | StoredInputs | null;
}

/** A job record's stored form. The request goes through JSON, as the server
 * reads it, so no undefined field reaches the record; only the sources of
 * refs it still names are kept. Inputs already in their stored form are kept
 * as they are, their bytes already stored. */
export function splitJob(job: JobRecord): { record: StoredJob; blobs: Map<string, Blob> } {
  const blobs = new Map<string, Blob>();
  const request = JSON.parse(JSON.stringify(job.request)) as Record<string, JsonValue>;
  const refs: Record<string, Source> = {};
  for (const ref of refsIn(request)) {
    const from = job.refs[ref];
    if (from) refs[ref] = from;
  }
  let inputs: StoredInputs | null = null;
  if (job.inputs && "schema" in job.inputs) {
    inputs = structuredClone(job.inputs);
  } else if (job.inputs) {
    inputs = splitInputs(job.inputs, blobs);
  }
  return {
    record: {
      schema: JOB_SCHEMA,
      id: job.id,
      domain: job.domain,
      createdAt: job.createdAt,
      checkpoint: job.checkpoint && { ...job.checkpoint },
      request,
      refs,
      inputs,
      mapKeys: [...job.mapKeys],
      maps: { ...job.maps },
      routed: job.routed,
    },
    blobs,
  };
}

const DOMAINS: readonly JobDomain[] = [
  "generate",
  "upscale",
  "rembg",
  "process",
  "preprocess",
  "video",
  "framepack",
  "ltx",
  "xyz-grid",
];
const SOURCE_KINDS: readonly Source["kind"][] = ["composite", "file", "mask", "ipMask", "map"];

function sizePick(value: unknown, path: string): SizeSourcePick {
  const pick = fields<SizeSourcePick>(value, path);
  return exact(pick, path, {
    frameId: text(pick.frameId, `${path}.frameId`),
    pictureId: orNull(pick.pictureId, (id) => text(id, `${path}.pictureId`)),
  });
}

function size(value: unknown, path: string): Size {
  const s = fields<Size>(value, path);
  return exact(s, path, {
    width: num(s.width, `${path}.width`),
    height: num(s.height, `${path}.height`),
  });
}

function encoding(value: unknown, path: string): ProviderEncoding | null {
  return orNull(value, (raw) => {
    const e = fields<ProviderEncoding>(raw, path);
    return exact(e, path, {
      provider: text(e.provider, `${path}.provider`),
      model: text(e.model, `${path}.model`),
    });
  });
}

type SourceField = "kind" | "frameId" | "pictureId" | "maskId" | "drawnAt" | "encode" | "key";

function source(value: unknown, path: string): Source {
  const s = fields<Record<SourceField, unknown>>(value, path);
  const kind = oneOf(s.kind, SOURCE_KINDS, `${path}.kind`);
  const frameId = () => text(s.frameId, `${path}.frameId`);
  let read: Source;
  switch (kind) {
    case "composite":
      read = {
        kind,
        frameId: frameId(),
        drawnAt: size(s.drawnAt, `${path}.drawnAt`),
        encode: encoding(s.encode, `${path}.encode`),
      };
      break;
    case "file":
      read = { kind, frameId: frameId(), pictureId: text(s.pictureId, `${path}.pictureId`) };
      break;
    case "mask":
      read = { kind, frameId: frameId(), drawnAt: size(s.drawnAt, `${path}.drawnAt`) };
      break;
    case "ipMask":
      read = { kind, frameId: frameId(), maskId: text(s.maskId, `${path}.maskId`) };
      break;
    case "map":
      read = {
        kind,
        key: text(s.key, `${path}.key`),
        drawnAt: orNull(s.drawnAt, (raw) => size(raw, `${path}.drawnAt`)),
        encode: encoding(s.encode, `${path}.encode`),
      };
      break;
  }
  return exact<Source>(s, path, read);
}

function texts(value: unknown, path: string): Record<string, string> {
  const t = fields<Record<string, string>>(value, path);
  return Object.fromEntries(Object.entries(t).map(([key, v]) => [key, text(v, `${path}.${key}`)]));
}

export interface ReadJob {
  record: StoredJob;
  /** Every cid the record names, its frames' and its sent maps', once each. */
  cids: string[];
}

/** A stored job record checked field by field, like the working document. */
export function readJob(value: unknown): ReadJob {
  const r = fields<StoredJob>(value, "job");
  const schema = num(r.schema, "job.schema");
  if (schema > JOB_SCHEMA) throw new NewerDocument(schema);
  const cids = new Set<string>();
  const inputs = orNull(r.inputs, (raw) => readInputs(raw, "job.inputs", cids));
  const refs = fields<Record<string, Source>>(r.refs, "job.refs");
  const maps = texts(r.maps, "job.maps");
  for (const cid of Object.values(maps)) cids.add(cid);
  const request = fields<Record<string, JsonValue>>(r.request, "job.request");
  const record = exact(r, "job", {
    schema: JOB_SCHEMA,
    id: text(r.id, "job.id"),
    domain: oneOf(r.domain, DOMAINS, "job.domain"),
    createdAt: num(r.createdAt, "job.createdAt"),
    checkpoint: orNull(r.checkpoint, (raw) => {
      const c = fields<{ title: string; name: string }>(raw, "job.checkpoint");
      return exact(c, "job.checkpoint", {
        title: text(c.title, "job.checkpoint.title"),
        name: text(c.name, "job.checkpoint.name"),
      });
    }),
    request: Object.fromEntries(
      Object.entries(request).map(([key, v]) => [key, json(v, `job.request.${key}`)]),
    ),
    refs: Object.fromEntries(
      Object.entries(refs).map(([ref, v]) => [ref, source(v, `job.refs.${ref}`)]),
    ),
    inputs,
    mapKeys: list(r.mapKeys, "job.mapKeys").map((k, i) => text(k, `job.mapKeys[${i}]`)),
    maps,
    routed: flag(r.routed, "job.routed"),
  });
  return { record, cids: [...cids] };
}

/** Inputs in their stored form, their bytes put aside in `blobs`. */
function splitInputs(inputs: Inputs, blobs: Map<string, Blob>): StoredInputs {
  return {
    schema: DOCUMENT_SCHEMA,
    size: { ...inputs.size },
    sizeSource: inputs.sizeSource && { ...inputs.sizeSource },
    frames: splitInto(inputs.frames, blobs),
  };
}

/** Stored inputs checked like the working document, their frames read at the
 * schema they were stored with; the cids they name go into `cids`. */
function readInputs(value: unknown, path: string, cids: Set<string>): StoredInputs {
  const i = fields<StoredInputs>(value, path);
  const framesSchema = num(i.schema, `${path}.schema`);
  if (framesSchema > DOCUMENT_SCHEMA) throw new NewerDocument(framesSchema);
  const read = readStoredFrames(i.frames, framesSchema);
  for (const cid of read.cids) cids.add(cid);
  return exact(i, path, {
    schema: DOCUMENT_SCHEMA,
    size: size(i.size, `${path}.size`),
    sizeSource: orNull(i.sizeSource, (pick) => sizePick(pick, `${path}.sizeSource`)),
    frames: read.frames,
  });
}

/** Stored inputs with their bytes back. */
export function joinInputs(
  inputs: StoredInputs,
  blobs: ReadonlyMap<string, Blob>,
): { inputs: Inputs; lost: JoinLoss } {
  const { frames, lost } = joinFrames(inputs.frames, blobs);
  return { inputs: { size: { ...inputs.size }, sizeSource: inputs.sizeSource, frames }, lost };
}

export const ENTRY_SCHEMA = 1;

/** A frame saved on its own, added to the inputs when recalled, or a set of
 * frames, which takes the inputs' place. */
export type EntryKind = "frame" | "set";

const ENTRY_KINDS: readonly EntryKind[] = ["frame", "set"];

/** A saved frame or set in the library, under its own id. */
export interface StoredEntry {
  schema: number;
  id: string;
  kind: EntryKind;
  name: string;
  savedAt: number;
  /** When it was saved, then each time it was recalled or brought back. */
  usedAt: number;
  pinned: boolean;
  /** When it went to the trash; null while it is in the library. */
  trashedAt: number | null;
  inputs: StoredInputs;
  /** The cid of each map that was current when it was saved, by key. */
  maps: Record<string, string>;
}

/** A library entry with the bytes of its frames. */
export interface Entry extends Omit<StoredEntry, "schema" | "inputs"> {
  inputs: Inputs;
}

/** An entry's stored form, the bytes of its frames put aside in `blobs`. */
export function splitEntry(entry: Entry): { record: StoredEntry; blobs: Map<string, Blob> } {
  const blobs = new Map<string, Blob>();
  return {
    record: {
      schema: ENTRY_SCHEMA,
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      savedAt: entry.savedAt,
      usedAt: entry.usedAt,
      pinned: entry.pinned,
      trashedAt: entry.trashedAt,
      inputs: splitInputs(entry.inputs, blobs),
      maps: { ...entry.maps },
    },
    blobs,
  };
}

export interface ReadEntry {
  record: StoredEntry;
  /** Every cid the entry names, its frames' and its maps', once each. */
  cids: string[];
}

/** A stored library entry checked field by field, like the working document. */
export function readEntry(value: unknown): ReadEntry {
  const r = fields<StoredEntry>(value, "entry");
  const schema = num(r.schema, "entry.schema");
  if (schema > ENTRY_SCHEMA) throw new NewerDocument(schema);
  const cids = new Set<string>();
  const inputs = readInputs(r.inputs, "entry.inputs", cids);
  const maps = texts(r.maps, "entry.maps");
  for (const cid of Object.values(maps)) cids.add(cid);
  const record = exact(r, "entry", {
    schema: ENTRY_SCHEMA,
    id: text(r.id, "entry.id"),
    kind: oneOf(r.kind, ENTRY_KINDS, "entry.kind"),
    name: text(r.name, "entry.name"),
    savedAt: num(r.savedAt, "entry.savedAt"),
    usedAt: num(r.usedAt, "entry.usedAt"),
    pinned: flag(r.pinned, "entry.pinned"),
    trashedAt: orNull(r.trashedAt, (raw) => num(raw, "entry.trashedAt")),
    inputs,
    maps,
  });
  return { record, cids: [...cids] };
}

/** A library entry with its bytes back. */
export function joinEntry(
  record: StoredEntry,
  blobs: ReadonlyMap<string, Blob>,
): { entry: Entry; lost: JoinLoss } {
  const { inputs, lost } = joinInputs(record.inputs, blobs);
  const { schema: _schema, ...rest } = record;
  return { entry: { ...rest, inputs, maps: { ...record.maps } }, lost };
}
