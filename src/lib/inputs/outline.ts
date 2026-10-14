// What the frame list means: where each frame stands, what it sends, the
// number each sent picture answers to, the map each processed picture is
// sent as, and what keeps the request from being built. Both the canvas and
// the Input tab read their labels from here, and the request builder sends
// exactly `sent`, `controls` and `ipAdapters`.

import type { EffectiveLimit } from "@/lib/media/limits";
import type { Declaration } from "@/lib/media/rules";
import {
  fitTo,
  ruleRefusal,
  type Fit,
  type RuleRefusal,
  type SizeLimits,
  type SizeRule,
} from "@/lib/media/sizeRule";
import { compositeSpec, completeParams, fileSpec, mapKey, type PictureSpec } from "./freshness";
import { unreadableText } from "./text";
import {
  activeProcessor,
  composedPictures,
  hasMask,
  isComposed,
  slotPictures,
  type ControlSettings,
  type ControlType,
  type Frame,
  type FrameRole,
  type IpAdapterSettings,
  type JsonValue,
  type MediaKind,
  type PlacedPicture,
  type ProcessorSpec,
  type Size,
} from "./types";

/** How a prompt names a sent picture: "Image 3". Counted per kind across all frames. */
export interface Address {
  kind: MediaKind;
  n: number;
}

/** Where a processed picture's map stands. "needed": no map for this content
 * yet; "unknown": the cache has not been asked yet. */
export type MapState = "current" | "needed" | "queued" | "processing" | "failed" | "unknown";

/** The map a picture is sent as: its key, what it is made from, and where it stands. */
export interface MapSlot {
  key: string;
  processor: ProcessorSpec;
  /** Parameters as sent: the frame's over the server's defaults. */
  params: Record<string, JsonValue>;
  spec: PictureSpec;
  state: MapState;
  /** Why the processor failed, with state "failed". */
  reason: string | null;
}

export interface SentInput {
  address: Address;
  frameId: string;
  role: FrameRole;
  /** The picture a Reference frame sends; null for an Initial frame's composite. */
  pictureId: string | null;
  /** Natural size of that picture, or of the composite's bottom picture. */
  width: number;
  height: number;
  /** The frame carries mask strokes or mask objects. */
  masked: boolean;
  /** Bytes it is made of could not be read. */
  unreadable: boolean;
  /** The map sent in the picture's place, when the frame has a processor
   * and the outline was given the processing facts. */
  map: MapSlot | null;
  /** The size the picture goes out at, smaller than its own: a set member
   * under the model's rule, when the outline was given the size facts. */
  fit: Fit | null;
  /** What the picture goes out at, for a set member; null otherwise and for
   * a picture that cannot be sent. */
  sentSize: SentSize | null;
}

/** The size a picture goes out at, and why. */
export type SentSize =
  /** Resized from `from` to the size the model uses. */
  | { kind: "fitted"; size: Size; from: Size }
  /** At its own size: the model declares none (`noRule`), this server does
   * not report sizes, Crop needs the whole picture, or the model uses it at
   * that size (`fits`). */
  | { kind: "whole"; size: Size; why: "noRule" | "unreported" | "crop" | "fits" }
  /** What the model uses is known once it is loaded. */
  | { kind: "unknown"; size: Size }
  /** To a provider: at most the longest side it takes, from `from`, which
   * its file size limit can lower further. */
  | { kind: "atMost"; size: Size; from: Size };

/** "off": switched off. "empty": on, with nothing to send. "notSent": on and
 * holding content, which no control model takes for the reason in `notSent`. */
export type FrameStatus = "sent" | "empty" | "off" | "notSent";

/** Why a Control or IP-Adapter frame that is on sends nothing. */
export type NotSentReason = "noModel" | "noPicture" | "linkBroken";

/** One cell of a set frame: a picture it shows, sent or hidden. */
export interface OutlineSlot {
  pictureId: string;
  /** Null while the picture is not sent, always for a control picture. */
  address: Address | null;
  /** What a sent Reference or IP-Adapter picture goes out at. */
  sentSize: SentSize | null;
}

export type ProblemCode = OutlineProblem["code"];

export interface OutlineEntry {
  frameId: string;
  /** The N of "Input N": the frame's place in the list, whatever it holds. */
  position: number;
  role: FrameRole;
  status: FrameStatus;
  notSent: NotSentReason | null;
  sent: SentInput[];
  /** A set frame's pictures in order, leaving out those a role switch hid.
   * Empty for a composed frame. */
  slots: OutlineSlot[];
  /** Pictures the last role switch hid. */
  hiddenBySwitch: number;
  /** Position of the frame a Control frame takes its picture from, when linked. */
  linkedTo: number | null;
  /** The processor the frame's pictures go through, by id, whether or not
   * the frame sends; null when it has none or its role takes none. */
  processor: string | null;
  /** The maps this frame's sent pictures are replaced by. */
  maps: MapSlot[];
  /** The problems this frame is part of. */
  blockedBy: ProblemCode[];
}

/** A Control frame's picture as it travels: the composite of `sourceFrameId`
 * under the frame's settings, or its map. */
export interface ControlSend {
  frameId: string;
  position: number;
  sourceFrameId: string;
  settings: ControlSettings;
  map: MapSlot | null;
  unreadable: boolean;
}

export interface IpAdapterSend {
  frameId: string;
  position: number;
  pictureIds: string[];
  settings: IpAdapterSettings;
  unreadable: boolean;
  /** Each picture's size as it goes out, aligned with `pictureIds`. */
  fits: (Fit | null)[];
  sentSizes: (SentSize | null)[];
}

/** Something the request cannot carry as the frames stand. Each one has words
 * in text.ts and a fix: in problems.ts, or, for `cloudMaps`, a processing job. */
export type OutlineProblem =
  | { code: "mixedControlTypes"; frames: { position: number; type: ControlType }[] }
  /** More images sent than the model takes: `over` lists the pictures past
   * the limit, `positions` the frames they are in. */
  | {
      code: "tooManyImages";
      limit: number;
      sent: number;
      positions: number[];
      over: { position: number; frameId: string; pictureId: string | null; address: Address }[];
    }
  /** Frames sending a picture whose bytes could not be read. */
  | { code: "unreadable"; positions: number[] }
  /** Initial frames with a mask while the images go out as a set, which takes no mask. */
  | { code: "maskWithSet"; positions: number[]; images: number }
  /** Control and IP-Adapter frames sending while the images go out as a set. */
  | { code: "controlWithSet"; positions: number[]; images: number }
  /** Frames whose map is not current on a model that runs elsewhere and cannot process. */
  | { code: "cloudMaps"; positions: number[] }
  /** Frames sending a picture larger than the browser or the server takes. */
  | { code: "tooLarge"; positions: number[]; pictures: TooLargePicture[]; limit: EffectiveLimit }
  /** Pictures the model refuses at the size they go out at. */
  | { code: "ruleRefused"; positions: number[]; pictures: RefusedPicture[]; limits: SizeLimits };

export interface RefusedPicture {
  position: number;
  frameId: string;
  /** Null for an Initial frame's composite. */
  pictureId: string | null;
  /** Null for an IP-Adapter picture, which the prompt does not number. */
  address: Address | null;
  name: string;
  size: Size;
  refusal: RuleRefusal;
}

export interface TooLargePicture {
  position: number;
  frameId: string;
  pictureId: string;
  name: string;
  size: Size;
}

export interface Outline {
  entries: OutlineEntry[];
  /** Everything sent to the model's image list, in the order the model receives it. */
  sent: SentInput[];
  controls: ControlSend[];
  ipAdapters: IpAdapterSend[];
  /** The images go out as one set: several of them, or a lone Reference on a
   * model whose output size the request sets. */
  set: boolean;
  problems: OutlineProblem[];
}

/** What the outline needs to say where each map stands. Without it no slot
 * is computed and `map` is null everywhere. */
export interface ProcessingEnv {
  /** The runner's revision, part of every key. */
  revision: string;
  /** Each processor's default parameters, by id. */
  defaults: Record<string, Record<string, JsonValue>>;
  /** Keys whose map the cache holds. */
  current: Pick<ReadonlySet<string>, "has">;
  /** Keys the cache has been asked about, found or not. */
  lookedUp: ReadonlySet<string>;
  /** Keys a job is making. */
  pending: ReadonlyMap<string, "queued" | "processing">;
  /** Keys whose last run failed, with the reason. */
  failed: ReadonlyMap<string, string>;
  /** The model runs elsewhere and cannot process, so every map must be current. */
  cloud: boolean;
  /** Counts every change to the cache, the jobs and the failures, for callers
   * that key a cache of outlines on these facts. */
  stamp: number;
  /** Width and Height as set. */
  frame: Size;
  /** The size the model generates at, which a set, a separate init and
   * every control picture are resized to before they go out. */
  target: Size;
}

export interface OutlineEnv {
  /** The loaded checkpoint carries its control model, so a ControlNet frame needs none. */
  controlUnified?: boolean;
  /** Most input images the model takes in one request; null or absent while unknown. */
  maxInputImages?: number | null;
  /** The request sets the output size, also from a single input image. */
  requestSetsSize?: boolean | null;
  processing?: ProcessingEnv | null;
  /** The largest picture the browser and the server take; absent or null takes any. */
  inputLimit?: EffectiveLimit | null;
  /** What the model resizes input pictures to; without it nothing is fitted
   * and no sent size is given. */
  sizes?: SizeEnv | null;
  /** A provider's longest side, for a cloud model: every sent picture is
   * encoded for it, so each says the most it goes out at. */
  cloud?: { rule: SizeRule | null; target: Size } | null;
}

export interface SizeEnv {
  /** What a set's members are resized to: references and Initial composites. */
  reference: Declaration;
  /** What IP-Adapter pictures are resized to. */
  ipAdapter: Declaration;
  /** The size the request generates at, which a set's Initial composite is
   * drawn at before its rule applies. */
  target: Size;
}

/** What a model resizes input pictures to, apart from the request's size. */
export type ModelSizes = Omit<SizeEnv, "target">;

type Unnumbered = Omit<SentInput, "address" | "map" | "fit" | "sentSize"> & { kind: MediaKind };

type Sizing = Pick<SentInput, "fit" | "sentSize">;

const NOT_SIZED: Sizing = { fit: null, sentSize: null };

/** What a picture of `size` goes out at under a declaration. */
function sizedBy(declaration: Declaration, size: Size, crop: boolean): Sizing {
  const whole = (why: "noRule" | "unreported" | "crop" | "fits"): Sizing => ({
    fit: null,
    sentSize: { kind: "whole", size, why },
  });
  if (crop) return whole("crop");
  if (declaration.kind === "unknown") return { fit: null, sentSize: { kind: "unknown", size } };
  if (declaration.kind === "unreported") return whole("unreported");
  const { rule } = declaration.declared;
  if (!rule) return whole("noRule");
  const fit = fitTo(rule, size);
  if (!fit) return whole("fits");
  return {
    fit,
    sentSize: { kind: "fitted", size: { width: fit.width, height: fit.height }, from: size },
  };
}

/** How a set's Initial composite is drawn for its fit: at a stretch fit's
 * size, else at the output size and, for a cover fit, cropped and resized
 * after, as the model would. */
export function compositeDraw(fit: Fit | null, target: Size): { drawnAt: Size; fit: Fit | null } {
  if (fit?.mode === "stretch")
    return { drawnAt: { width: fit.width, height: fit.height }, fit: null };
  return { drawnAt: target, fit };
}

/** The most a picture goes out at to a provider: a reference from its own
 * size, a composite from the request's. The encoder makes the copy. */
function encodedFor(
  cloud: { rule: SizeRule | null; target: Size },
  frame: Frame,
  input: SentInput,
): Sizing {
  const picture = frame.pictures.find((p) => p.id === input.pictureId);
  const from = picture ? { width: picture.width, height: picture.height } : cloud.target;
  const fit = cloud.rule ? fitTo(cloud.rule, from) : null;
  const size = fit ? { width: fit.width, height: fit.height } : from;
  return { fit: null, sentSize: { kind: "atMost", size, from } };
}

const overLimit = (p: Size, limit: EffectiveLimit | null | undefined) =>
  limit != null && p.width * p.height > limit.pixels;

function frameSends(frame: Frame): Unnumbered[] {
  if (!frame.enabled) return [];
  const shared = { frameId: frame.id, role: frame.role };
  if (isComposed(frame.role)) {
    const layers = composedPictures(frame);
    if (layers.length === 0) return [];
    return [
      {
        ...shared,
        kind: "image",
        pictureId: null,
        width: layers[0].width,
        height: layers[0].height,
        masked: hasMask(frame),
        unreadable: layers.some((p) => p.file === null),
      },
    ];
  }
  return slotPictures(frame).map((p) => ({
    ...shared,
    kind: p.media,
    pictureId: p.id,
    width: p.width,
    height: p.height,
    masked: false,
    unreadable: p.file === null,
  }));
}

function needsModel(settings: ControlSettings, env: OutlineEnv): boolean {
  if (settings.type === "style_transfer") return false;
  return !(settings.type === "controlnet" && env.controlUnified);
}

/** The frame whose composite a Control frame sends: its link's target, else itself. */
function controlSource(
  frames: Frame[],
  frame: Frame,
): { source: Frame; layers: PlacedPicture[] } | "linkBroken" {
  if (!frame.link) return { source: frame, layers: composedPictures(frame) };
  const target = frames.find((f) => f.id === frame.link?.frameId);
  if (!target || target.id === frame.id || !isComposed(target.role)) return "linkBroken";
  return { source: target, layers: composedPictures(target) };
}

function mapState(key: string, env: ProcessingEnv): Pick<MapSlot, "state" | "reason"> {
  if (env.current.has(key)) return { state: "current", reason: null };
  const pending = env.pending.get(key);
  if (pending) return { state: pending, reason: null };
  const reason = env.failed.get(key);
  if (reason !== undefined) return { state: "failed", reason };
  return { state: env.lookedUp.has(key) ? "needed" : "unknown", reason: null };
}

function mapSlot(spec: PictureSpec, processor: ProcessorSpec, env: ProcessingEnv): MapSlot {
  const params = completeParams(processor, env.defaults[processor.id]);
  const key = mapKey(spec, processor, params, env.revision);
  return { key, processor, params, spec, ...mapState(key, env) };
}

type Settled = Omit<OutlineEntry, "blockedBy" | "maps">;

const ascending = (positions: Iterable<number>) => [...new Set(positions)].sort((a, b) => a - b);

function findProblems(
  entries: Settled[],
  sent: SentInput[],
  controls: ControlSend[],
  ipAdapters: IpAdapterSend[],
  set: boolean,
  env: OutlineEnv,
): OutlineProblem[] {
  const problems: OutlineProblem[] = [];
  const positionOf = new Map(entries.map((e) => [e.frameId, e.position]));
  const limit = env.maxInputImages ?? null;
  if (limit !== null && sent.length > limit) {
    const over = sent.slice(limit).map((s) => ({
      position: positionOf.get(s.frameId) ?? 0,
      frameId: s.frameId,
      pictureId: s.pictureId,
      address: s.address,
    }));
    problems.push({
      code: "tooManyImages",
      limit,
      sent: sent.length,
      positions: ascending(over.map((o) => o.position)),
      over,
    });
  }
  const unreadable = ascending([
    ...sent.filter((s) => s.unreadable).map((s) => positionOf.get(s.frameId) ?? 0),
    ...[...controls, ...ipAdapters].filter((s) => s.unreadable).map((s) => s.position),
  ]);
  if (unreadable.length > 0) problems.push({ code: "unreadable", positions: unreadable });
  if (set) {
    const masked = ascending(
      sent.filter((s) => s.masked).map((s) => positionOf.get(s.frameId) ?? 0),
    );
    if (masked.length > 0) {
      problems.push({ code: "maskWithSet", positions: masked, images: sent.length });
    }
    const control = ascending([...controls, ...ipAdapters].map((s) => s.position));
    if (control.length > 0) {
      problems.push({ code: "controlWithSet", positions: control, images: sent.length });
    }
  }
  const types = [...new Set(controls.map((c) => c.settings.type))];
  if (types.length > 1) {
    problems.push({
      code: "mixedControlTypes",
      frames: controls.map((c) => ({ position: c.position, type: c.settings.type })),
    });
  }
  if (env.processing?.cloud) {
    // Only the image list goes to a provider. A key not looked up yet is not
    // a problem until the cache has answered.
    const stale = (map: MapSlot | null) =>
      map !== null && map.state !== "current" && map.state !== "unknown";
    const positions = ascending(
      sent.filter((s) => stale(s.map)).map((s) => positionOf.get(s.frameId) ?? 0),
    );
    if (positions.length > 0) problems.push({ code: "cloudMaps", positions });
  }
  return problems;
}

/** The pictures of enabled frames over the limit: a composed frame's layers, a
 * set's shown pictures and an IP-Adapter frame's masks. */
function tooLarge(frames: Frame[], limit: EffectiveLimit): OutlineProblem | null {
  const pictures = frames.flatMap((frame, index) => {
    if (!frame.enabled) return [];
    const shown = isComposed(frame.role) ? composedPictures(frame) : slotPictures(frame);
    const masks = frame.role === "ipAdapter" ? frame.ipAdapter.masks : [];
    return [...shown, ...masks]
      .filter((p) => p.file !== null && p.width * p.height > limit.pixels)
      .map((p) => ({
        position: index + 1,
        frameId: frame.id,
        pictureId: p.id,
        name: p.name,
        size: { width: p.width, height: p.height },
      }));
  });
  if (pictures.length === 0) return null;
  return {
    code: "tooLarge",
    positions: ascending(pictures.map((p) => p.position)),
    pictures,
    limit,
  };
}

/** The pictures the model refuses at the size they go out at: set members
 * under the reference declaration's limits, IP-Adapter pictures under the
 * adapter's unless Crop leaves the picture to the server. */
function ruleRefused(
  entries: Settled[],
  ipAdapters: IpAdapterSend[],
  frameOf: ReadonlyMap<string, Frame>,
  sizes: SizeEnv,
): OutlineProblem | null {
  const refused: RefusedPicture[] = [];
  // set inside check, which narrowing from the initial null would not see
  let limits = null as SizeLimits | null;
  const check = (
    declaration: Declaration,
    sent: SentSize | null,
    picture: Omit<RefusedPicture, "size" | "refusal">,
  ) => {
    if (declaration.kind !== "declared" || !sent) return;
    const refusal = ruleRefusal(declaration.declared, sent.size);
    if (!refusal) return;
    limits ??= declaration.declared.limits ?? {};
    refused.push({ ...picture, size: sent.size, refusal });
  };
  const nameOf = (frameId: string, pictureId: string | null) =>
    frameOf.get(frameId)?.pictures.find((p) => p.id === pictureId)?.name ?? "";
  for (const entry of entries) {
    for (const input of entry.sent) {
      check(sizes.reference, input.sentSize, {
        position: entry.position,
        frameId: input.frameId,
        pictureId: input.pictureId,
        address: input.address,
        name: nameOf(input.frameId, input.pictureId),
      });
    }
  }
  for (const send of ipAdapters) {
    if (send.settings.crop) continue;
    send.pictureIds.forEach((pictureId, i) => {
      check(sizes.ipAdapter, send.sentSizes[i] ?? null, {
        position: send.position,
        frameId: send.frameId,
        pictureId,
        address: null,
        name: nameOf(send.frameId, pictureId),
      });
    });
  }
  if (refused.length === 0 || !limits) return null;
  return {
    code: "ruleRefused",
    positions: ascending(refused.map((p) => p.position)),
    pictures: refused,
    limits,
  };
}

/** The positions a problem names. */
export function problemPositions(problem: OutlineProblem): number[] {
  return problem.code === "mixedControlTypes"
    ? problem.frames.map((f) => f.position)
    : problem.positions;
}

export function computeOutline(frames: Frame[], env: OutlineEnv = {}): Outline {
  const next: Record<MediaKind, number> = { image: 1, video: 1, audio: 1 };
  const controls: ControlSend[] = [];
  const ipAdapters: IpAdapterSend[] = [];
  const sources = new Map<string, Frame>();
  const settled = frames.map((frame, index): Settled => {
    const position = index + 1;
    const shown = isComposed(frame.role) ? [] : frame.pictures.filter((p) => !p.hiddenBySwitch);
    const linkedIndex = frame.link ? frames.findIndex((f) => f.id === frame.link?.frameId) : -1;
    const entry = {
      frameId: frame.id,
      position,
      role: frame.role,
      hiddenBySwitch: frame.pictures.filter((p) => p.hiddenBySwitch).length,
      linkedTo: frame.role === "control" && linkedIndex !== -1 ? linkedIndex + 1 : null,
      processor: activeProcessor(frame)?.id ?? null,
    };
    const settle = (status: FrameStatus, notSent: NotSentReason | null = null) => ({
      ...entry,
      status,
      notSent,
      sent: [] as SentInput[],
      slots: shown.map((p): OutlineSlot => ({ pictureId: p.id, address: null, sentSize: null })),
    });
    if (!frame.enabled) return settle("off");
    if (frame.role === "control") {
      const resolved = controlSource(frames, frame);
      if (resolved === "linkBroken") return settle("notSent", "linkBroken");
      if (resolved.layers.length === 0)
        return settle(frame.link ? "notSent" : "empty", frame.link ? "noPicture" : null);
      if (needsModel(frame.control, env) && frame.control.model === "None") {
        return settle("notSent", "noModel");
      }
      sources.set(frame.id, resolved.source);
      controls.push({
        frameId: frame.id,
        position,
        sourceFrameId: resolved.source.id,
        settings: frame.control,
        map: null,
        unreadable: resolved.layers.some((p) => p.file === null),
      });
      return settle("sent");
    }
    if (frame.role === "ipAdapter") {
      const pictures = slotPictures(frame);
      if (pictures.length === 0) return settle("empty");
      if (frame.ipAdapter.adapter === "None") return settle("notSent", "noModel");
      const declared = env.sizes?.ipAdapter;
      const sized = pictures.map((p) =>
        !declared || p.file === null || overLimit(p, env.inputLimit)
          ? NOT_SIZED
          : sizedBy(declared, { width: p.width, height: p.height }, frame.ipAdapter.crop),
      );
      ipAdapters.push({
        frameId: frame.id,
        position,
        pictureIds: pictures.map((p) => p.id),
        settings: frame.ipAdapter,
        unreadable: [...pictures, ...frame.ipAdapter.masks].some((p) => p.file === null),
        fits: sized.map((s) => s.fit),
        sentSizes: sized.map((s) => s.sentSize),
      });
      const sent = settle("sent");
      return {
        ...sent,
        slots: sent.slots.map((slot) => {
          const i = pictures.findIndex((p) => p.id === slot.pictureId);
          return i === -1 ? slot : { ...slot, sentSize: sized[i].sentSize };
        }),
      };
    }
    const sent = frameSends(frame).map(({ kind, ...rest }): SentInput => {
      return { ...rest, address: { kind, n: next[kind]++ }, map: null, ...NOT_SIZED };
    });
    return {
      ...settle(sent.length > 0 ? "sent" : "empty"),
      sent,
      slots: shown.map((p) => ({
        pictureId: p.id,
        address: sent.find((s) => s.pictureId === p.id)?.address ?? null,
        sentSize: null,
      })),
    };
  });
  const plain = settled.flatMap((e) => e.sent);
  const set =
    plain.length > 1 ||
    (plain.length === 1 && plain[0].role === "reference" && env.requestSetsSize === true);

  // What each set member goes out at: a reference under the model's rule
  // from its own size, an Initial composite from the generation size
  const frameOf = new Map(frames.map((f) => [f.id, f]));
  const sizes = env.sizes ?? null;
  const cloud = env.cloud ?? null;
  const sizeInput = (input: SentInput): SentInput => {
    const frame = frameOf.get(input.frameId);
    if (cloud && !input.unreadable && frame)
      return { ...input, ...encodedFor(cloud, frame, input) };
    if (!sizes || !set || input.unreadable || !frame) return input;
    if (input.pictureId === null) {
      if (composedPictures(frame).some((p) => overLimit(p, env.inputLimit))) return input;
      return { ...input, ...sizedBy(sizes.reference, sizes.target, false) };
    }
    const picture = frame.pictures.find((p) => p.id === input.pictureId);
    if (!picture || overLimit(picture, env.inputLimit)) return input;
    return {
      ...input,
      ...sizedBy(sizes.reference, { width: picture.width, height: picture.height }, false),
    };
  };
  const sized = settled.map((e) => {
    if (e.sent.length === 0) return e;
    const sent = e.sent.map(sizeInput);
    const slots = e.slots.map((slot) => ({
      ...slot,
      sentSize: sent.find((s) => s.pictureId === slot.pictureId)?.sentSize ?? null,
    }));
    return { ...e, sent, slots };
  });

  // The maps, once it is known how the pictures travel: a plain img2img
  // init goes out at frame size and the server resizes it; a set, a
  // separate init beside control pictures, and every control picture are
  // resized to the generation size first, a set member to its fitted size.
  const processing = env.processing ?? null;
  const withMap = (input: SentInput): SentInput => {
    const frame = frameOf.get(input.frameId);
    const processor = frame && activeProcessor(frame);
    if (!processing || !frame || !processor) return input;
    if (input.pictureId !== null) {
      const picture = frame.pictures.find((p) => p.id === input.pictureId);
      if (!picture) return input;
      return { ...input, map: mapSlot(fileSpec(picture, input.fit), processor, processing) };
    }
    const layers = composedPictures(frame);
    if (set) {
      const { drawnAt, fit } = compositeDraw(input.fit, processing.target);
      const spec = compositeSpec(layers, processing.frame, drawnAt, fit);
      return { ...input, map: mapSlot(spec, processor, processing) };
    }
    const out = controls.length > 0 ? processing.target : processing.frame;
    const spec = compositeSpec(layers, processing.frame, out);
    return { ...input, map: mapSlot(spec, processor, processing) };
  };
  const mapped = processing
    ? sized.map((e) => (e.sent.length > 0 ? { ...e, sent: e.sent.map(withMap) } : e))
    : sized;
  if (processing) {
    for (const send of controls) {
      const frame = frameOf.get(send.frameId);
      const source = sources.get(send.frameId);
      const processor = frame && activeProcessor(frame);
      if (!frame || !source || !processor) continue;
      const spec = compositeSpec(composedPictures(source), processing.frame, processing.target);
      send.map = mapSlot(spec, processor, processing);
    }
  }
  const sent = mapped.flatMap((e) => e.sent);
  const problems = findProblems(mapped, sent, controls, ipAdapters, set, env);
  const oversize = env.inputLimit ? tooLarge(frames, env.inputLimit) : null;
  if (oversize) problems.push(oversize);
  const refused = sizes ? ruleRefused(mapped, ipAdapters, frameOf, sizes) : null;
  if (refused) problems.push(refused);
  const controlMaps = new Map(controls.map((c) => [c.frameId, c.map]));
  const entries = mapped.map((entry): OutlineEntry => {
    const own = controlMaps.get(entry.frameId);
    const maps = own ? [own] : entry.sent.flatMap((s) => (s.map ? [s.map] : []));
    return {
      ...entry,
      maps,
      blockedBy: problems
        .filter((p) => problemPositions(p).includes(entry.position))
        .map((p) => p.code),
    };
  });
  return { entries, sent, controls, ipAdapters, set, problems };
}

export function outlineEntry(outline: Outline, frameId: string): OutlineEntry | undefined {
  return outline.entries.find((e) => e.frameId === frameId);
}

/** The first Initial frame that sends a picture. */
export function firstInitialEntry(outline: Outline): OutlineEntry | undefined {
  return outline.entries.find((e) => e.role === "initial" && e.sent.length > 0);
}

/** The layers of the first Initial frame that sends a picture, bottom to top;
 * null when none does. Throws, with words for the user, when one of the
 * layers could not be read. */
export function firstComposite(frames: Frame[]): PlacedPicture[] | null {
  const entry = firstInitialEntry(computeOutline(frames));
  const frame = entry && frames.find((f) => f.id === entry.frameId);
  if (!entry || !frame) return null;
  const unreadable = unreadableText([entry]);
  if (unreadable) throw new Error(unreadable);
  return composedPictures(frame);
}

/** The Reference picture that is the only thing sent, else null. */
export function loneReference(outline: Outline): SentInput | null {
  const [only, ...rest] = outline.sent;
  return only && rest.length === 0 && only.role === "reference" ? only : null;
}

/** The number a Control frame's picture would get if the frame were sent as
 * an image instead (a Reference frame), or null when it would send nothing. */
export function sentAsImage(
  frames: Frame[],
  frameId: string,
  env: OutlineEnv = {},
): Address | null {
  const switched = frames.map((f): Frame => (f.id === frameId ? { ...f, role: "reference" } : f));
  const entry = outlineEntry(computeOutline(switched, env), frameId);
  return entry?.sent[0]?.address ?? null;
}

/** A sent picture picked to set the frame size: a frame, plus one of its
 * pictures when the pick was made on a Reference frame. */
export interface SizeSourcePick {
  frameId: string;
  pictureId: string | null;
}

export function sizeSourcePick(input: SentInput): SizeSourcePick {
  return { frameId: input.frameId, pictureId: input.pictureId };
}

/** Where the frame size comes from. "first": Image 1, nothing picked.
 * "lost": the picked picture is no longer sent while others are, so the size
 * stays as it is until the pick changes. */
export type SizeSourceState =
  | { kind: "none" }
  | { kind: "first"; input: SentInput }
  | { kind: "picked"; input: SentInput }
  | { kind: "lost"; pick: SizeSourcePick };

/** A pick follows its frame across a role switch, to the frame's first
 * picture or to its composite. */
export function sizeSourceState(sent: SentInput[], pick: SizeSourcePick | null): SizeSourceState {
  if (sent.length === 0) return { kind: "none" };
  if (!pick) return { kind: "first", input: sent[0] };
  const picked = sent.find(
    (s) =>
      s.frameId === pick.frameId &&
      (s.pictureId === null || pick.pictureId === null || s.pictureId === pick.pictureId),
  );
  return picked ? { kind: "picked", input: picked } : { kind: "lost", pick };
}

/** The sent picture that sets the frame size, or null: nothing is sent, or
 * the pick is lost and the size is kept. */
export function resolveSizeSource(
  sent: SentInput[],
  pick: SizeSourcePick | null,
): SentInput | null {
  const state = sizeSourceState(sent, pick);
  return state.kind === "first" || state.kind === "picked" ? state.input : null;
}
