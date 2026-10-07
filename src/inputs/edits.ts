// What a user does to the input list that is worth telling and undoing. Every
// removal writes a record the trash keeps for the retention period and offers
// Undo; every change that renumbers the sent pictures says which.

import { useGenerationStore } from "@/stores/generationStore";
import { useInputStore } from "@/stores/inputStore";
import { outlineEntry, type SentInput } from "@/lib/inputs/outline";
import { newFrame } from "@/lib/inputs/reducers";
import { addressChanges } from "@/lib/inputs/renumber";
import type { Removal } from "@/lib/inputs/stored";
import { positionLabel, renumberText } from "@/lib/inputs/text";
import {
  hasMask,
  type ControlType,
  type Frame,
  type FrameRole,
  type Size,
} from "@/lib/inputs/types";
import { revealFrame } from "./reveal";
import { forgetRemoval, recordRemoval } from "./trash";
import { offerUndo } from "./undo";
import { outlineOf } from "./useOutline";

const holdsContent = (frame: Frame) =>
  frame.pictures.length > 0 ||
  hasMask(frame) ||
  frame.ipAdapter.masks.length > 0 ||
  frame.processed !== null;

const sentNow = (): SentInput[] => outlineOf(useInputStore.getState().frames).sent;

const positionOf = (frameId: string): number =>
  outlineEntry(outlineOf(useInputStore.getState().frames), frameId)?.position ?? 0;

/** Put a frame back where it was, or its content into the frame that took its place. */
function putBackFrame(frame: Frame, index: number, linkedFrom: string[] = []): void {
  const store = useInputStore.getState();
  if (store.frames.some((f) => f.id === frame.id)) store.mergeContent(frame.id, frame);
  else store.putBackFrame(frame, index, linkedFrom);
}

/** Keep a record of the removal, tell it, and offer to undo it. The notice
 * waits for the record, so a page closed right after cannot lose both. */
async function removed(
  removal: Removal,
  title: string,
  renumber: string | null,
  putBack: () => void,
): Promise<void> {
  let key: string | null = null;
  try {
    key = await recordRemoval(removal);
  } catch (err) {
    console.error("[inputs] could not keep what was removed", err);
  }
  offerUndo(title, renumber, () => {
    putBack();
    if (key) forgetRemoval(key);
  });
}

/** Remove a frame. The last frame stays. */
export function removeFrame(frameId: string): void {
  const store = useInputStore.getState();
  const index = store.frames.findIndex((f) => f.id === frameId);
  if (index < 0 || store.frames.length < 2) return;
  const frame = store.frames[index];
  const position = positionOf(frameId);
  const before = sentNow();
  const linkedFrom = store.frames.filter((f) => f.link?.frameId === frameId).map((f) => f.id);
  store.removeFrame(frameId);
  const removal: Removal = {
    removedAt: Date.now(),
    from: { position, frameId, role: frame.role },
    content: { kind: "frame", index, frame, linkedFrom },
  };
  void removed(
    removal,
    `${positionLabel(position)} removed`,
    renumberText(addressChanges(before, sentNow())),
    () => putBackFrame(frame, index, linkedFrom),
  );
}

/** Remove one picture from a frame. */
export function removePicture(frameId: string, pictureId: string): void {
  const store = useInputStore.getState();
  const frame = store.frames.find((f) => f.id === frameId);
  const index = frame?.pictures.findIndex((p) => p.id === pictureId) ?? -1;
  if (!frame || index < 0) return;
  const picture = frame.pictures[index];
  const position = positionOf(frameId);
  const before = sentNow();
  store.removePicture(frameId, pictureId);
  const removal: Removal = {
    removedAt: Date.now(),
    from: { position, frameId, role: frame.role },
    content: { kind: "picture", index, picture },
  };
  void removed(
    removal,
    `"${picture.name}" removed from ${positionLabel(position)}`,
    renumberText(addressChanges(before, sentNow())),
    () => {
      const current = useInputStore.getState();
      if (current.frames.some((f) => f.id === frameId)) {
        current.insertPicture(frameId, picture, index);
      } else {
        putBackFrame({ ...newFrame(frameId, frame.role), pictures: [picture] }, index);
      }
    },
  );
}

/** Remove everything a frame holds; the frame stays. */
export function clearFrame(frameId: string): void {
  const store = useInputStore.getState();
  const frame = store.frames.find((f) => f.id === frameId);
  if (!frame || !holdsContent(frame)) return;
  const position = positionOf(frameId);
  const before = sentNow();
  store.clearFrame(frameId);
  const removal: Removal = {
    removedAt: Date.now(),
    from: { position, frameId, role: frame.role },
    content: { kind: "contents", frame },
  };
  void removed(
    removal,
    `${positionLabel(position)} cleared`,
    renumberText(addressChanges(before, sentNow())),
    () => putBackFrame(frame, store.frames.indexOf(frame)),
  );
}

/** Remove everything every frame holds; the frames stay. */
export function clearAllFrames(): void {
  const store = useInputStore.getState();
  const frames = store.frames;
  if (!frames.some(holdsContent)) return;
  for (const frame of frames) store.clearFrame(frame.id);
  const removal: Removal = {
    removedAt: Date.now(),
    from: { position: 1, frameId: frames[0].id, role: frames[0].role },
    content: { kind: "frames", frames },
  };
  void removed(removal, "All inputs cleared", null, () => {
    frames.forEach((frame, index) => putBackFrame(frame, index));
  });
}

/** Switch a frame on or off. False when the model's limit refused it. */
export function setFrameOn(frameId: string, on: boolean): boolean {
  const before = sentNow();
  if (!useInputStore.getState().setEnabled(frameId, on)) return false;
  const renumber = renumberText(addressChanges(before, sentNow()));
  if (renumber) {
    offerUndo(`${positionLabel(positionOf(frameId))} ${on ? "on" : "off"}`, renumber, () => {
      useInputStore.getState().setEnabled(frameId, !on);
    });
  }
  return true;
}

export function moveFrame(from: number, to: number): void {
  const before = sentNow();
  useInputStore.getState().moveFrame(from, to);
  const renumber = renumberText(addressChanges(before, sentNow()));
  if (renumber) {
    offerUndo(`${positionLabel(from + 1)} is now ${positionLabel(to + 1)}`, renumber, () =>
      useInputStore.getState().moveFrame(to, from),
    );
  }
}

/** The frames a result was made from take the list's place, at the frame
 * size they were made at. What was there goes to the trash. */
export function restoreFrames(frames: Frame[], size: Size): void {
  const store = useInputStore.getState();
  const gen = useGenerationStore.getState();
  const previous = { frames: store.frames, sizeSource: store.sizeSource };
  const previousSize = { width: gen.width, height: gen.height };
  store.restoreFrames(frames);
  gen.setParams({ width: size.width, height: size.height });
  const putBack = () => {
    useInputStore.getState().restoreFrames(previous.frames);
    useInputStore.getState().setSizeSource(previous.sizeSource);
    useGenerationStore.getState().setParams(previousSize);
  };
  if (!previous.frames.some(holdsContent)) {
    offerUndo("Inputs restored from the result", null, putBack);
    return;
  }
  const removal: Removal = {
    removedAt: Date.now(),
    from: { position: 1, frameId: previous.frames[0].id, role: previous.frames[0].role },
    content: { kind: "frames", frames: previous.frames },
  };
  void removed(removal, "Inputs restored from the result", null, putBack);
}

/** Add a frame at the end of the list, give a Control frame its type, and
 * bring it into view. Returns its id. */
export function addFrame(role: FrameRole, type?: ControlType): string {
  const inputs = useInputStore.getState();
  const id = inputs.addFrame(role);
  if (type) inputs.patchControl(id, { type });
  revealFrame(id);
  return id;
}
