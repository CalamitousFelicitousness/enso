// The input document: one ordered list of frames, each holding the pictures it
// composes or sends. Plain data only; object URLs and decoded images belong to
// the media module.

export type MediaKind = "image" | "video" | "audio";

/** What a frame does with its pictures: an Initial frame flattens them into
 * one picture, a Reference frame sends each one. */
export type FrameRole = "initial" | "reference";

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
  /** Bottom to top in an Initial frame, send order in a Reference frame. */
  pictures: Picture[];
  /** Read while the frame is Initial. */
  mask: MaskContent;
}

/** The selected layer of a frame: a picture or a mask object. */
export interface ActiveItem {
  frameId: string;
  id: string;
}

export function isComposed(role: FrameRole): boolean {
  return role === "initial";
}

export function isPlaced(picture: Picture): picture is PlacedPicture {
  return picture.transform !== null;
}

/** The pictures an Initial frame flattens, bottom to top. */
export function composedPictures(frame: Frame): PlacedPicture[] {
  return frame.pictures.filter((p): p is PlacedPicture => p.visible && isPlaced(p));
}

/** The pictures a Reference frame sends, in order. */
export function slotPictures(frame: Frame): Picture[] {
  return frame.pictures.filter((p) => p.visible);
}

export function hasMask(frame: Frame): boolean {
  return frame.mask.objects.length > 0 || frame.mask.strokes.length > 0;
}
