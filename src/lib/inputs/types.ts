// The input document: one ordered list of frames, each holding the pictures it
// composes or sends. Plain data only; object URLs and decoded images belong to
// the media module.

export type MediaKind = "image" | "video" | "audio";

/** What a frame does with its pictures. Initial and Control frames flatten
 * them into one picture; Reference and IP-Adapter frames send each one. An
 * Initial or Reference picture is an image the model receives and the prompt
 * can name; a Control or IP-Adapter picture feeds a control model only. */
export type FrameRole = "initial" | "reference" | "control" | "ipAdapter";

/** Placement in frame pixels, applied as flattenCanvas draws it: translate,
 * rotate (degrees), scale, then the natural-size pixels at the origin. */
export interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface Size {
  width: number;
  height: number;
}

/** How a composed frame places its base picture whenever the frame changes
 * size. Null: placed by hand, left where it is. */
export type FitPolicy = "contain" | "cover" | "fill";

/** The control model kinds sdnext runs as control units. */
export type ControlType = "controlnet" | "t2i" | "xs" | "lite" | "style_transfer";
export const CONTROL_TYPES: readonly ControlType[] = [
  "controlnet",
  "t2i",
  "xs",
  "lite",
  "style_transfer",
];

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** How a Control frame drives the model: which control model runs on the
 * frame's picture, with what weight, over which steps. */
export interface ControlSettings {
  type: ControlType;
  model: string;
  mode: string;
  strength: number;
  start: number;
  end: number;
  /** ControlNet only. */
  guess: boolean;
  /** T2I-Adapter only. */
  factor: number;
  /** Style transfer only. */
  attention: string;
  fidelity: number;
  queryWeight: number;
  adainWeight: number;
}

/** The sdnext processor a frame's pictures go through before the model sees
 * them, one map per picture in the picture's place. `params` holds the
 * values picked for it; the server's defaults fill the rest. */
export interface ProcessorSpec {
  id: string;
  params: Record<string, JsonValue>;
}

/** How an IP-Adapter frame's pictures steer the model. */
export interface IpAdapterSettings {
  adapter: string;
  scale: number;
  crop: boolean;
  start: number;
  end: number;
  /** Region masks, in the order of the frame's pictures. */
  masks: Picture[];
}

export interface Picture {
  id: string;
  /** Names the bytes: new on import or replace, shared by copies of a picture. */
  cid: string;
  /** Null when the stored bytes could not be read. */
  file: Blob | null;
  name: string;
  media: MediaKind;
  /** Natural size. */
  width: number;
  height: number;
  /** Hidden pictures are neither composited nor sent. */
  visible: boolean;
  /** Hidden by a role switch, which the switch back undoes. */
  hiddenBySwitch: boolean;
  locked: boolean;
  opacity: number;
  /** Null until the picture has been placed in a composition. */
  transform: Transform | null;
}

export type PlacedPicture = Picture & { transform: Transform };

/** A picture as the caller knows it before it joins a frame. */
export interface PictureSource {
  id: string;
  cid: string;
  file: Blob;
  name: string;
  width: number;
  height: number;
  media?: MediaKind;
}

/** One baked mask region: a tinted PNG drawn at width x height under its transform. */
export interface MaskObject {
  id: string;
  cid: string;
  blob: Blob;
  name: string;
  visible: boolean;
  locked: boolean;
  width: number;
  height: number;
  transform: Transform;
}

/** One paint stroke not yet baked into a mask object. */
export interface MaskStroke {
  /** Flat [x1, y1, x2, y2, ...] in frame pixels. */
  points: number[];
  strokeWidth: number;
  tool: "brush" | "eraser";
}

export interface MaskContent {
  objects: MaskObject[];
  strokes: MaskStroke[];
}

export interface Frame {
  id: string;
  role: FrameRole;
  /** An off frame keeps its content and sends nothing. */
  enabled: boolean;
  /** Bottom to top in a composed frame, send order in a set frame. */
  pictures: Picture[];
  /** Read while the frame is Initial. */
  mask: MaskContent;
  /** Read while the frame is composed. */
  fit: FitPolicy | null;
  /** Read while the frame is Control: the composed frame whose picture this
   * frame sends in place of its own. Resolved one hop, whatever that frame's
   * On switch says. */
  link: { frameId: string } | null;
  control: ControlSettings;
  ipAdapter: IpAdapterSettings;
  /** Read while the frame's role takes one (`takesProcessor`). */
  processor: ProcessorSpec | null;
}

/** The selected layer of a frame: a picture or a mask object. */
export interface ActiveItem {
  frameId: string;
  id: string;
}

export function isComposed(role: FrameRole): boolean {
  return role === "initial" || role === "control";
}

/** The frame's pictures feed a control model, not the model's image list. */
export function feedsControl(role: FrameRole): boolean {
  return role === "control" || role === "ipAdapter";
}

/** Whether the frame's pictures can go through a processor: an image the
 * model receives, or a control picture. IP-Adapter and style transfer take a
 * picture, not a map. */
export function takesProcessor(frame: Pick<Frame, "role" | "control">): boolean {
  if (frame.role === "ipAdapter") return false;
  return frame.role !== "control" || frame.control.type !== "style_transfer";
}

/** The processor the frame's pictures go through, or null. */
export function activeProcessor(frame: Frame): ProcessorSpec | null {
  return takesProcessor(frame) ? frame.processor : null;
}

export function isPlaced(picture: Picture): picture is PlacedPicture {
  return picture.transform !== null;
}

/** The pictures a composed frame flattens, bottom to top. */
export function composedPictures(frame: Frame): PlacedPicture[] {
  return frame.pictures.filter((p): p is PlacedPicture => p.visible && isPlaced(p));
}

/** The pictures a set frame sends, in order. */
export function slotPictures(frame: Frame): Picture[] {
  return frame.pictures.filter((p) => p.visible);
}

export function hasMask(frame: Frame): boolean {
  return frame.mask.objects.length > 0 || frame.mask.strokes.length > 0;
}
