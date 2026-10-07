// What the frame list means: where each frame stands, what it sends, the
// number each sent picture answers to, and what keeps the request from being
// built. Both the canvas and the Input tab read their labels from here, and
// the request builder sends exactly `sent`, `controls` and `ipAdapters`.

import { unreadableText } from "./text";
import {
  composedPictures,
  hasMask,
  isComposed,
  slotPictures,
  type ControlSettings,
  type ControlType,
  type Frame,
  type FrameRole,
  type IpAdapterSettings,
  type MediaKind,
  type PlacedPicture,
  type ProcessedPreview,
} from "./types";

/** How a prompt names a sent picture: "Image 3". Counted per kind across all frames. */
export interface Address {
  kind: MediaKind;
  n: number;
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
}

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
  /** A Control frame holds a processed map. */
  processed: boolean;
  /** The problems this frame is part of. */
  blockedBy: ProblemCode[];
}

/** A Control frame's picture as it travels: the composite of `sourceFrameId`
 * under the frame's settings. */
export interface ControlSend {
  frameId: string;
  position: number;
  sourceFrameId: string;
  settings: ControlSettings;
  processed: ProcessedPreview | null;
  unreadable: boolean;
}

export interface IpAdapterSend {
  frameId: string;
  position: number;
  pictureIds: string[];
  settings: IpAdapterSettings;
  unreadable: boolean;
}

/** Something the request cannot carry as the frames stand. Each one has a fix
 * in problems.ts and words in text.ts. */
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
  | { code: "controlWithSet"; positions: number[]; images: number };

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

export interface OutlineEnv {
  /** The loaded checkpoint carries its control model, so a ControlNet frame needs none. */
  controlUnified?: boolean;
  /** Most input images the model takes in one request; null or absent while unknown. */
  maxInputImages?: number | null;
  /** The request sets the output size, also from a single input image. */
  requestSetsSize?: boolean | null;
}

type Unnumbered = Omit<SentInput, "address"> & { kind: MediaKind };

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

type Settled = Omit<OutlineEntry, "blockedBy">;

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
  return problems;
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
      processed: frame.role === "control" && frame.processed !== null,
    };
    const settle = (status: FrameStatus, notSent: NotSentReason | null = null) => ({
      ...entry,
      status,
      notSent,
      sent: [] as SentInput[],
      slots: shown.map((p) => ({ pictureId: p.id, address: null })),
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
      controls.push({
        frameId: frame.id,
        position,
        sourceFrameId: resolved.source.id,
        settings: frame.control,
        processed: frame.processed,
        unreadable: resolved.layers.some((p) => p.file === null) || frame.processed?.blob === null,
      });
      return settle("sent");
    }
    if (frame.role === "ipAdapter") {
      const pictures = slotPictures(frame);
      if (pictures.length === 0) return settle("empty");
      if (frame.ipAdapter.adapter === "None") return settle("notSent", "noModel");
      ipAdapters.push({
        frameId: frame.id,
        position,
        pictureIds: pictures.map((p) => p.id),
        settings: frame.ipAdapter,
        unreadable: [...pictures, ...frame.ipAdapter.masks].some((p) => p.file === null),
      });
      return settle("sent");
    }
    const sent = frameSends(frame).map(({ kind, ...rest }): SentInput => {
      return { ...rest, address: { kind, n: next[kind]++ } };
    });
    return {
      ...settle(sent.length > 0 ? "sent" : "empty"),
      sent,
      slots: shown.map((p) => ({
        pictureId: p.id,
        address: sent.find((s) => s.pictureId === p.id)?.address ?? null,
      })),
    };
  });
  const sent = settled.flatMap((e) => e.sent);
  const set =
    sent.length > 1 ||
    (sent.length === 1 && sent[0].role === "reference" && env.requestSetsSize === true);
  const problems = findProblems(settled, sent, controls, ipAdapters, set, env);
  const entries = settled.map((entry): OutlineEntry => ({
    ...entry,
    blockedBy: problems
      .filter((p) => problemPositions(p).includes(entry.position))
      .map((p) => p.code),
  }));
  return { entries, sent, controls, ipAdapters, set, problems };
}

export function outlineEntry(outline: Outline, frameId: string): OutlineEntry | undefined {
  return outline.entries.find((e) => e.frameId === frameId);
}

/** The layers of the first Initial frame that sends a picture, bottom to top;
 * null when none does. Throws, with words for the user, when one of the
 * layers could not be read. */
export function firstComposite(frames: Frame[]): PlacedPicture[] | null {
  const entry = computeOutline(frames).entries.find(
    (e) => e.role === "initial" && e.sent.length > 0,
  );
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
