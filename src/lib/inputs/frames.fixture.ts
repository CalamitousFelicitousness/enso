// Builders for the unit tests of this folder.

import { newFrame } from "./reducers";
import type { Frame, FrameRole, MaskObject, Picture, Transform } from "./types";

const ORIGIN: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

/** An unplaced picture, as a Reference frame holds it. */
export function picture(id: string, patch: Partial<Picture> = {}): Picture {
  return {
    id,
    cid: `cid-${id}`,
    file: new Blob([id]),
    name: `${id}.png`,
    media: "image",
    width: 64,
    height: 64,
    visible: true,
    hiddenBySwitch: false,
    locked: false,
    opacity: 1,
    transform: null,
    ...patch,
  };
}

/** A picture placed in a composition, at the frame's origin unless told otherwise. */
export function layer(id: string, patch: Partial<Picture> = {}): Picture {
  return picture(id, { transform: ORIGIN, ...patch });
}

export function maskObject(id: string, patch: Partial<MaskObject> = {}): MaskObject {
  return {
    id,
    cid: `cid-${id}`,
    blob: new Blob([id]),
    name: id,
    visible: true,
    locked: true,
    width: 10,
    height: 10,
    transform: ORIGIN,
    ...patch,
  };
}

export function frame(id: string, role: FrameRole, ...pictures: Picture[]): Frame {
  return { ...newFrame(id, role), pictures };
}
