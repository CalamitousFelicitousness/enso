// Every change to the frame list, as functions from one value to the next.
// The store wraps them; nothing here reads state from anywhere else.

import { centredTransform, fitTransform, refitFrame } from "./geometry";
import {
  isComposed,
  isPlaced,
  type ActiveItem,
  type ControlSettings,
  type FitPolicy,
  type Frame,
  type FrameRole,
  type IpAdapterSettings,
  type MaskObject,
  type MaskStroke,
  type Picture,
  type PictureSource,
  type ProcessedPreview,
  type Size,
  type Transform,
} from "./types";

export function defaultControl(): ControlSettings {
  return {
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
}

export function defaultIpAdapter(): IpAdapterSettings {
  return { adapter: "None", scale: 0.5, crop: false, start: 0, end: 1, masks: [] };
}

/** A Control frame lays its picture over the frame by policy; the other roles place by hand. */
function fitFor(role: FrameRole, current: FitPolicy | null): FitPolicy | null {
  if (role === "control") return current ?? "contain";
  return role === "initial" ? null : current;
}

export function newFrame(id: string, role: FrameRole): Frame {
  return {
    id,
    role,
    enabled: true,
    pictures: [],
    mask: { objects: [], strokes: [] },
    fit: fitFor(role, null),
    link: null,
    control: defaultControl(),
    ipAdapter: defaultIpAdapter(),
    processed: null,
  };
}

/** Where a composed frame puts a picture that has none: by its fit policy, else inside the frame. */
function basePlacement(frame: Frame, natural: Size, size: Size): Transform {
  return fitTransform(natural, size, frame.fit ?? "contain");
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

/** Remove a frame; a Control frame that took its picture from it is left without a source. */
export function removeFrame(frames: Frame[], frameId: string): Frame[] {
  if (!frames.some((f) => f.id === frameId)) return frames;
  return frames
    .filter((f) => f.id !== frameId)
    .map((f) => (f.link?.frameId === frameId ? { ...f, link: null } : f));
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
 * come back first. A switch between two composed roles, or two set roles,
 * keeps everything else. Becoming composed keeps the composition the frame
 * has; with none, its first picture is laid over the frame, and every other
 * picture that was never placed is hidden until the switch back. */
export function switchRole(frame: Frame, role: FrameRole, size: Size): Frame {
  if (frame.role === role) return frame;
  const shown = frame.pictures.map((p) =>
    p.hiddenBySwitch ? { ...p, visible: true, hiddenBySwitch: false } : p,
  );
  const next = { ...frame, role, fit: fitFor(role, frame.fit) };
  if (!isComposed(role) || isComposed(frame.role)) return { ...next, pictures: shown };
  let hasBase = shown.some((p) => p.visible && isPlaced(p));
  const pictures = shown.map((p) => {
    if (!p.visible || isPlaced(p)) return p;
    if (!hasBase) {
      hasBase = true;
      return { ...p, transform: basePlacement(next, p, size) };
    }
    return { ...p, visible: false, hiddenBySwitch: true };
  });
  return { ...next, pictures };
}

/** Bring back every picture a role switch hid. In a composed frame each one
 * is laid over the frame. */
export function showHiddenBySwitch(frame: Frame, size: Size): Frame {
  return updatePictures(frame, (p) => {
    if (!p.hiddenBySwitch) return p;
    const transform = isComposed(frame.role)
      ? (p.transform ?? basePlacement(frame, p, size))
      : p.transform;
    return { ...p, visible: true, hiddenBySwitch: false, transform };
  });
}

/** Append a picture. A composed frame lays its first placed picture over the
 * frame and centres later ones at natural size. */
export function addPicture(frame: Frame, source: PictureSource, size: Size): Frame {
  const transform = !isComposed(frame.role)
    ? null
    : frame.pictures.some(isPlaced)
      ? centredTransform(source, size)
      : basePlacement(frame, source, size);
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

/** Place a picture by hand, which ends the frame's fit policy. Only a picture
 * that already has a placement can be moved. */
export function setPictureTransform(frame: Frame, pictureId: string, transform: Transform): Frame {
  const placed = updatePictures(frame, (p) =>
    p.id === pictureId && isPlaced(p) ? { ...p, transform } : p,
  );
  return placed === frame || placed.fit === null ? placed : { ...placed, fit: null };
}

/** Show or hide a picture by hand. Showing one a composed frame has never
 * placed lays it over the frame. */
export function setPictureVisible(
  frame: Frame,
  pictureId: string,
  visible: boolean,
  size: Size,
): Frame {
  return updatePictures(frame, (p) => {
    if (p.id !== pictureId || (p.visible === visible && !p.hiddenBySwitch)) return p;
    const transform =
      visible && isComposed(frame.role)
        ? (p.transform ?? basePlacement(frame, p, size))
        : p.transform;
    return { ...p, visible, hiddenBySwitch: false, transform };
  });
}

export function setEnabled(frame: Frame, enabled: boolean): Frame {
  return frame.enabled === enabled ? frame : { ...frame, enabled };
}

/** Give the frame a fit policy and lay its composition over the frame by it;
 * null leaves placements to the hand. */
export function setFit(frame: Frame, fit: FitPolicy | null, size: Size): Frame {
  if (frame.fit === fit) return frame;
  const next = { ...frame, fit };
  return fit === null ? next : refitFrame(next, size);
}

/** Point a Control frame at the composed frame whose picture it sends, or at none. */
export function setLink(frame: Frame, frameId: string | null): Frame {
  if ((frame.link?.frameId ?? null) === frameId) return frame;
  return { ...frame, link: frameId === null ? null : { frameId } };
}

export function patchControl(frame: Frame, patch: Partial<ControlSettings>): Frame {
  return { ...frame, control: { ...frame.control, ...patch } };
}

export function patchIpAdapter(
  frame: Frame,
  patch: Partial<Omit<IpAdapterSettings, "masks">>,
): Frame {
  return { ...frame, ipAdapter: { ...frame.ipAdapter, ...patch } };
}

export function addIpMask(frame: Frame, source: PictureSource): Frame {
  const masks = [...frame.ipAdapter.masks, newPicture(source)];
  return { ...frame, ipAdapter: { ...frame.ipAdapter, masks } };
}

export function clearIpMasks(frame: Frame): Frame {
  return frame.ipAdapter.masks.length === 0
    ? frame
    : { ...frame, ipAdapter: { ...frame.ipAdapter, masks: [] } };
}

export function removeIpMask(frame: Frame, pictureId: string): Frame {
  if (!frame.ipAdapter.masks.some((m) => m.id === pictureId)) return frame;
  const masks = frame.ipAdapter.masks.filter((m) => m.id !== pictureId);
  return { ...frame, ipAdapter: { ...frame.ipAdapter, masks } };
}

export function setProcessed(frame: Frame, processed: ProcessedPreview | null): Frame {
  return frame.processed === processed ? frame : { ...frame, processed };
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

/** Put a picture back at `at`, clamped to the list; one with that id already
 * there is left alone. */
export function insertPicture(frame: Frame, picture: Picture, at: number): Frame {
  if (frame.pictures.some((p) => p.id === picture.id)) return frame;
  const index = Math.max(0, Math.min(frame.pictures.length, at));
  const pictures = [...frame.pictures.slice(0, index), picture, ...frame.pictures.slice(index)];
  return { ...frame, pictures };
}

/** Give a frame back what a clear took out of it, beside what it holds now:
 * pictures, mask objects, strokes and IP-Adapter masks are appended, and a
 * processed map is taken only where the frame has none. */
export function mergeContent(frame: Frame, from: Frame): Frame {
  const absent = <T extends { id: string }>(have: T[], add: T[]) =>
    add.filter((item) => !have.some((h) => h.id === item.id));
  return {
    ...frame,
    pictures: [...frame.pictures, ...absent(frame.pictures, from.pictures)],
    mask: {
      objects: [...frame.mask.objects, ...absent(frame.mask.objects, from.mask.objects)],
      strokes: [...frame.mask.strokes, ...from.mask.strokes],
    },
    ipAdapter: {
      ...frame.ipAdapter,
      masks: [...frame.ipAdapter.masks, ...absent(frame.ipAdapter.masks, from.ipAdapter.masks)],
    },
    processed: frame.processed ?? from.processed,
  };
}
