// Every change to the frame list, as functions from one value to the next.
// The store wraps them; nothing here reads state from anywhere else.

import { centredTransform, containTransform } from "./geometry";
import {
  isComposed,
  isPlaced,
  type ActiveItem,
  type Frame,
  type FrameRole,
  type MaskObject,
  type MaskStroke,
  type Picture,
  type PictureSource,
  type Size,
  type Transform,
} from "./types";

export function newFrame(id: string, role: FrameRole): Frame {
  return { id, role, enabled: true, pictures: [], mask: { objects: [], strokes: [] } };
}

export function newPicture(source: PictureSource): Picture {
  return {
    id: source.id,
    cid: source.cid,
    file: source.file,
    name: source.name,
    media: source.media ?? "image",
    width: source.width,
    height: source.height,
    visible: true,
    hiddenBySwitch: false,
    locked: false,
    opacity: 1,
    transform: null,
  };
}

/** The list with one frame changed; the same list when the frame is not in
 * it or the change returns the frame untouched. */
export function updateFrame(
  frames: Frame[],
  frameId: string,
  change: (frame: Frame) => Frame,
): Frame[] {
  const index = frames.findIndex((f) => f.id === frameId);
  if (index === -1) return frames;
  const changed = change(frames[index]);
  if (changed === frames[index]) return frames;
  const next = frames.slice();
  next[index] = changed;
  return next;
}

/** `at` past either end inserts at that end. */
export function insertFrame(frames: Frame[], frame: Frame, at = frames.length): Frame[] {
  const index = Math.max(0, Math.min(frames.length, at));
  return [...frames.slice(0, index), frame, ...frames.slice(index)];
}

export function removeFrame(frames: Frame[], frameId: string): Frame[] {
  return frames.some((f) => f.id === frameId) ? frames.filter((f) => f.id !== frameId) : frames;
}

/** The list with one item moved; the same list for a move that changes nothing. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < list.length;
  if (!valid(from) || !valid(to) || from === to) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function updatePictures(frame: Frame, change: (picture: Picture) => Picture): Frame {
  let touched = false;
  const pictures = frame.pictures.map((p) => {
    const next = change(p);
    if (next !== p) touched = true;
    return next;
  });
  return touched ? { ...frame, pictures } : frame;
}

/** Switch what the frame does with its pictures. Pictures the last switch hid
 * come back first. Becoming Initial keeps the composition the frame has; with
 * none, its first picture is fitted inside the frame, and every other picture
 * that was never placed is hidden until the switch back. */
export function switchRole(frame: Frame, role: FrameRole, size: Size): Frame {
  if (frame.role === role) return frame;
  const shown = frame.pictures.map((p) =>
    p.hiddenBySwitch ? { ...p, visible: true, hiddenBySwitch: false } : p,
  );
  if (!isComposed(role)) return { ...frame, role, pictures: shown };
  let hasBase = shown.some((p) => p.visible && isPlaced(p));
  const pictures = shown.map((p) => {
    if (!p.visible || isPlaced(p)) return p;
    if (!hasBase) {
      hasBase = true;
      return { ...p, transform: containTransform(p, size) };
    }
    return { ...p, visible: false, hiddenBySwitch: true };
  });
  return { ...frame, role, pictures };
}

/** Bring back every picture a role switch hid. In an Initial frame each one
 * is fitted inside the frame. */
export function showHiddenBySwitch(frame: Frame, size: Size): Frame {
  return updatePictures(frame, (p) => {
    if (!p.hiddenBySwitch) return p;
    const transform = isComposed(frame.role)
      ? (p.transform ?? containTransform(p, size))
      : p.transform;
    return { ...p, visible: true, hiddenBySwitch: false, transform };
  });
}

/** Append a picture. An Initial frame fits its first placed picture inside the
 * frame and centres later ones at natural size. */
export function addPicture(frame: Frame, source: PictureSource, size: Size): Frame {
  const place = frame.pictures.some(isPlaced) ? centredTransform : containTransform;
  const transform = isComposed(frame.role) ? place(source, size) : null;
  return { ...frame, pictures: [...frame.pictures, { ...newPicture(source), transform }] };
}

/** Replace the frame's pictures with one at the frame's origin, unscaled: an
 * image already at frame size. Pictures a role switch hid belong to the
 * frame's other role and stay. */
export function setOnlyPicture(frame: Frame, source: PictureSource): Frame {
  const transform: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
  const parked = frame.pictures.filter((p) => p.hiddenBySwitch);
  return { ...frame, pictures: [{ ...newPicture(source), transform }, ...parked] };
}

export function removePicture(frame: Frame, pictureId: string): Frame {
  return frame.pictures.some((p) => p.id === pictureId)
    ? { ...frame, pictures: frame.pictures.filter((p) => p.id !== pictureId) }
    : frame;
}

export function clearPictures(frame: Frame): Frame {
  return frame.pictures.length === 0 ? frame : { ...frame, pictures: [] };
}

export function movePicture(frame: Frame, from: number, to: number): Frame {
  const pictures = moveItem(frame.pictures, from, to);
  return pictures === frame.pictures ? frame : { ...frame, pictures };
}

export type PicturePatch = Partial<Pick<Picture, "name" | "locked" | "opacity">>;

export function patchPicture(frame: Frame, pictureId: string, patch: PicturePatch): Frame {
  return updatePictures(frame, (p) => (p.id === pictureId ? { ...p, ...patch } : p));
}

/** Place a picture. Only a picture that already has a placement can be moved. */
export function setPictureTransform(frame: Frame, pictureId: string, transform: Transform): Frame {
  return updatePictures(frame, (p) =>
    p.id === pictureId && isPlaced(p) ? { ...p, transform } : p,
  );
}

/** Show or hide a picture by hand. Showing one an Initial frame has never
 * placed fits it inside the frame. */
export function setPictureVisible(
  frame: Frame,
  pictureId: string,
  visible: boolean,
  size: Size,
): Frame {
  return updatePictures(frame, (p) => {
    if (p.id !== pictureId || (p.visible === visible && !p.hiddenBySwitch)) return p;
    const transform =
      visible && isComposed(frame.role) ? (p.transform ?? containTransform(p, size)) : p.transform;
    return { ...p, visible, hiddenBySwitch: false, transform };
  });
}

export function setEnabled(frame: Frame, enabled: boolean): Frame {
  return frame.enabled === enabled ? frame : { ...frame, enabled };
}

export function addStroke(frame: Frame, stroke: MaskStroke): Frame {
  return { ...frame, mask: { ...frame.mask, strokes: [...frame.mask.strokes, stroke] } };
}

export function clearStrokes(frame: Frame): Frame {
  return frame.mask.strokes.length === 0
    ? frame
    : { ...frame, mask: { ...frame.mask, strokes: [] } };
}

/** Install a bake: `objects` replace the frame's mask objects and the first
 * `consumed` strokes, which the bake drew into them, are dropped. */
export function applyBake(frame: Frame, consumed: number, objects: MaskObject[]): Frame {
  return { ...frame, mask: { objects, strokes: frame.mask.strokes.slice(consumed) } };
}

export function clearMaskObjects(frame: Frame): Frame {
  return frame.mask.objects.length === 0
    ? frame
    : { ...frame, mask: { ...frame.mask, objects: [] } };
}

export function removeMaskObject(frame: Frame, objectId: string): Frame {
  return frame.mask.objects.some((m) => m.id === objectId)
    ? {
        ...frame,
        mask: { ...frame.mask, objects: frame.mask.objects.filter((m) => m.id !== objectId) },
      }
    : frame;
}

export type MaskObjectPatch = Partial<
  Pick<MaskObject, "name" | "visible" | "locked" | "transform">
>;

export function patchMaskObject(frame: Frame, objectId: string, patch: MaskObjectPatch): Frame {
  if (!frame.mask.objects.some((m) => m.id === objectId)) return frame;
  return {
    ...frame,
    mask: {
      ...frame.mask,
      objects: frame.mask.objects.map((m) => (m.id === objectId ? { ...m, ...patch } : m)),
    },
  };
}

/** Whether the frame still holds the layer an ActiveItem names. */
export function holdsItem(frame: Frame, itemId: string): boolean {
  return (
    frame.pictures.some((p) => p.id === itemId) || frame.mask.objects.some((m) => m.id === itemId)
  );
}

export interface Selection {
  selectedFrameId: string | null;
  activeItem: ActiveItem | null;
}

/** The selection after the frame list changed from `previous` to `frames`. A
 * selected frame that is gone hands over to the one before it; the active
 * layer survives only in the selected frame, while that frame is Initial and
 * still holds it. */
export function settleSelection(
  frames: Frame[],
  previous: Frame[],
  { selectedFrameId, activeItem }: Selection,
): Selection {
  let selected = selectedFrameId;
  if (selected !== null && !frames.some((f) => f.id === selected)) {
    const was = previous.findIndex((f) => f.id === selected);
    selected = frames[Math.max(0, was - 1)]?.id ?? null;
  }
  const owner =
    activeItem?.frameId === selected ? frames.find((f) => f.id === selected) : undefined;
  const kept = activeItem && owner && isComposed(owner.role) && holdsItem(owner, activeItem.id);
  return { selectedFrameId: selected, activeItem: kept ? activeItem : null };
}

/** Change part of a layer's placement: a placed picture's or a mask object's. */
export function patchTransform(frame: Frame, itemId: string, patch: Partial<Transform>): Frame {
  const picture = frame.pictures.find((p) => p.id === itemId);
  if (picture?.transform) {
    return setPictureTransform(frame, itemId, { ...picture.transform, ...patch });
  }
  const object = frame.mask.objects.find((m) => m.id === itemId);
  return object
    ? patchMaskObject(frame, itemId, { transform: { ...object.transform, ...patch } })
    : frame;
}

/** Remove a layer, picture or mask object. */
export function removeItem(frame: Frame, itemId: string): Frame {
  return removeMaskObject(removePicture(frame, itemId), itemId);
}
