// Reads the control units the control store kept before they were frames: the
// `enso-control` record, a list of unit snapshots with every picture as base64.
// The caller decodes the pictures and measures them; the conversion here is
// pure, and each unit is converted on its own.

import type { ImportNote } from "./legacy";
import { textHash } from "./legacy";
import { fitTransform } from "./geometry";
import { loose } from "./loose";
import { defaultControl, defaultIpAdapter, newFrame, newPicture } from "./reducers";
import {
  CONTROL_TYPES,
  type FitPolicy,
  type Frame,
  type JsonValue,
  type Picture,
  type Size,
  type Transform,
} from "./types";

/** One unit as the control store snapshotted it; pictures still base64. */
export interface RawControlUnit {
  enabled: boolean;
  unitType: string;
  imageSource: string;
  processor: string;
  model: string;
  mode: string;
  strength: number;
  start: number;
  end: number;
  image: string | null;
  processedImage: string | null;
  guess: boolean;
  factor: number;
  attention: string;
  fidelity: number;
  queryWeight: number;
  adainWeight: number;
  adapter: string;
  scale: number;
  crop: boolean;
  images: string[];
  masks: string[];
  fitMode: string;
  freeTransform: Transform | null;
  processorParams: Record<string, unknown>;
}

/** Picture bytes decoded and measured by the caller. */
export interface LegacyBytes {
  blob: Blob;
  width: number;
  height: number;
}

export type LegacyControlUnit = Omit<
  RawControlUnit,
  "image" | "processedImage" | "images" | "masks"
> & {
  image: LegacyBytes | null;
  processedImage: LegacyBytes | null;
  images: LegacyBytes[];
  masks: LegacyBytes[];
};

export interface ControlImport {
  frames: Frame[];
  notes: ImportNote[];
}

export interface ControlImportContext {
  /** The frame size the units were laid out against. */
  size: Size;
  /** Height of the frame as the old canvas displayed it; free transforms were kept in those units. */
  displayHeight: number;
  /** The first Initial frame, which units on the canvas source took their picture from. */
  initialFrameId: string | null;
}

const isText = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numberOr = (v: unknown, fallback: number) => (isNum(v) ? v : fallback);
const textOr = (v: unknown, fallback: string) => (isText(v) && v !== "" ? v : fallback);
const flagOr = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isText) : []);

function transformOr(value: unknown): Transform | null {
  const t = loose<Transform>(value);
  if (!t || !isNum(t.x) || !isNum(t.y) || !isNum(t.scaleX) || !isNum(t.scaleY)) return null;
  return { x: t.x, y: t.y, scaleX: t.scaleX, scaleY: t.scaleY, rotation: numberOr(t.rotation, 0) };
}

function unitOf(value: unknown): RawControlUnit | null {
  const u = loose<RawControlUnit>(value);
  if (!u) return null;
  const params = loose<Record<string, unknown>>(u.processorParams);
  return {
    enabled: flagOr(u.enabled, false),
    unitType: textOr(u.unitType, "controlnet"),
    imageSource: textOr(u.imageSource, "canvas"),
    processor: textOr(u.processor, "None"),
    model: textOr(u.model, "None"),
    mode: textOr(u.mode, "default"),
    strength: numberOr(u.strength, 1),
    start: numberOr(u.start, 0),
    end: numberOr(u.end, 1),
    image: isText(u.image) && u.image !== "" ? u.image : null,
    processedImage: isText(u.processedImage) && u.processedImage !== "" ? u.processedImage : null,
    guess: flagOr(u.guess, false),
    factor: numberOr(u.factor, 1),
    attention: textOr(u.attention, "Attention"),
    fidelity: numberOr(u.fidelity, 0.5),
    queryWeight: numberOr(u.queryWeight, 1),
    adainWeight: numberOr(u.adainWeight, 1),
    adapter: textOr(u.adapter, "None"),
    scale: numberOr(u.scale, 0.5),
    crop: flagOr(u.crop, false),
    images: texts(u.images),
    masks: texts(u.masks),
    fitMode: textOr(u.fitMode, "contain"),
    freeTransform: transformOr(u.freeTransform),
    processorParams: params ? { ...params } : {},
  };
}

/** The stored list read loosely: an entry that is not an object is dropped,
 * a missing field takes the control store's default. */
export function readLegacyControl(value: unknown): RawControlUnit[] {
  return Array.isArray(value) ? value.flatMap((v) => unitOf(v) ?? []) : [];
}

/** Identity of the record's content: unit kinds, sources, settings and the
 * pictures' sizes in base64. A moved picture changes it; a reorder does too. */
export function controlFingerprint(value: unknown): string {
  const parts = readLegacyControl(value).map((u) =>
    [
      u.unitType,
      u.enabled,
      u.imageSource,
      u.model,
      u.processor,
      u.adapter,
      u.image?.length ?? 0,
      u.processedImage?.length ?? 0,
      u.images.map((s) => s.length).join(","),
      u.masks.map((s) => s.length).join(","),
    ].join(":"),
  );
  return textHash(parts.join("\n"));
}

const FITS: readonly FitPolicy[] = ["contain", "cover", "fill"];

/** Everything JSON can hold, as the unit stored it; other values are dropped. */
function jsonParams(params: Record<string, unknown>): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(params)) {
    try {
      out[key] = JSON.parse(JSON.stringify(value)) as JsonValue;
    } catch {
      // not representable, left out
    }
  }
  return out;
}

/** A unit the store created and nobody touched: the one it always kept. */
function isPlaceholder(unit: LegacyControlUnit): boolean {
  return (
    !unit.enabled &&
    unit.unitType === "controlnet" &&
    unit.imageSource === "canvas" &&
    unit.image === null &&
    unit.processedImage === null &&
    unit.model === "None" &&
    unit.processor === "None" &&
    unit.images.length === 0
  );
}

function pictureFrom(
  bytes: LegacyBytes,
  name: string,
  newId: () => string,
  newCid: () => string,
): Picture {
  return newPicture({ id: newId(), cid: newCid(), file: bytes.blob, name, ...bytes });
}

/** The old free transform, kept in display units relative to the frame
 * origin, in frame pixels. */
function frameTransform(free: Transform, context: ControlImportContext): Transform {
  const ds = context.displayHeight / context.size.height;
  return {
    x: free.x / ds,
    y: free.y / ds,
    scaleX: free.scaleX / ds,
    scaleY: free.scaleY / ds,
    rotation: free.rotation,
  };
}

/** The frames the units become, in the units' order, plus what the import
 * changed. `unit:N` sources become links to the frame made from unit N; the
 * canvas source becomes a link to the first Initial frame with the unit
 * switched off, since such units were never sent; IP-Adapter units take
 * their images and masks as a set. A placeholder nothing links to is dropped. */
export function controlToFrames(
  units: LegacyControlUnit[],
  context: ControlImportContext,
  newId: () => string,
  newCid: () => string,
): ControlImport {
  const notes: ImportNote[] = [];
  const linkedTo = new Set<number>();
  for (const unit of units) {
    const match = /^unit:(\d+)$/.exec(unit.imageSource);
    if (match && unit.unitType !== "ip") linkedTo.add(Number(match[1]));
  }
  const frameIds = units.map((unit, index) =>
    isPlaceholder(unit) && !linkedTo.has(index) ? null : newId(),
  );
  const ownPicture = (index: number) =>
    units[index] !== undefined && units[index].unitType !== "ip" && units[index].image !== null;

  const frames: Frame[] = [];
  units.forEach((unit, index) => {
    const id = frameIds[index];
    if (id === null) return;
    const position = frames.length + 1;
    if (unit.unitType === "ip") {
      const frame = newFrame(id, "ipAdapter");
      frames.push({
        ...frame,
        enabled: unit.enabled,
        pictures: unit.images.map((bytes, i) => pictureFrom(bytes, `ref-${i}.png`, newId, newCid)),
        ipAdapter: {
          ...defaultIpAdapter(),
          adapter: unit.adapter,
          scale: unit.scale,
          crop: unit.crop,
          start: unit.start,
          end: unit.end,
          masks: unit.masks.map((bytes, i) => pictureFrom(bytes, `mask-${i}.png`, newId, newCid)),
        },
      });
      return;
    }
    const known = CONTROL_TYPES.find((t) => t === unit.unitType);
    let enabled = unit.enabled;
    if (!known && enabled) {
      enabled = false;
      notes.push({ kind: "controlOff", position, reason: "retiredType" });
    }
    const frame: Frame = {
      ...newFrame(id, "control"),
      enabled,
      control: {
        ...defaultControl(),
        type: known ?? "controlnet",
        model: unit.model,
        mode: unit.mode,
        strength: unit.strength,
        start: unit.start,
        end: unit.end,
        guess: unit.guess,
        factor: unit.factor,
        attention: unit.attention,
        fidelity: unit.fidelity,
        queryWeight: unit.queryWeight,
        adainWeight: unit.adainWeight,
        process: unit.processor,
        processParams: jsonParams(unit.processorParams),
      },
      processed: unit.processedImage
        ? {
            cid: newCid(),
            blob: unit.processedImage.blob,
            width: unit.processedImage.width,
            height: unit.processedImage.height,
          }
        : null,
    };
    const match = /^unit:(\d+)$/.exec(unit.imageSource);
    if (unit.imageSource === "separate" && unit.image) {
      const fit = FITS.find((f) => f === unit.fitMode) ?? null;
      const transform =
        fit === null
          ? unit.freeTransform
            ? frameTransform(unit.freeTransform, context)
            : fitTransform(unit.image, context.size, "contain")
          : fitTransform(unit.image, context.size, fit);
      const picture = { ...pictureFrom(unit.image, "control.png", newId, newCid), transform };
      frames.push({ ...frame, fit, pictures: [picture] });
    } else if (match) {
      const source = Number(match[1]);
      const target = frameIds[source];
      if (target !== null && target !== undefined && ownPicture(source)) {
        frames.push({ ...frame, link: { frameId: target } });
      } else {
        notes.push({ kind: "controlUnlinked", position });
        frames.push(frame);
      }
    } else {
      if (enabled) notes.push({ kind: "controlOff", position, reason: "neverSent" });
      frames.push({
        ...frame,
        enabled: false,
        link: context.initialFrameId ? { frameId: context.initialFrameId } : null,
      });
    }
  });
  return { frames, notes };
}
