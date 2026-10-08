// What a user does to the input list that is worth telling and undoing. Every
// removal writes a record the trash keeps for the retention period and offers
// Undo; every change that renumbers the sent pictures says which.

import { toast } from "sonner";
import { useGenerationStore } from "@/stores/generationStore";
import { useInputStore } from "@/stores/inputStore";
import { resizeBlob } from "@/lib/resize";
import {
  computeOutline,
  outlineEntry,
  type OutlineEnv,
  type SentInput,
} from "@/lib/inputs/outline";
import { newFrame } from "@/lib/inputs/reducers";
import { addressChanges } from "@/lib/inputs/renumber";
import type { JobInputs, Removal } from "@/lib/inputs/stored";
import { positionLabel, renumberText } from "@/lib/inputs/text";
import {
  composedPictures,
  holdsContent,
  isComposed,
  type ControlType,
  type Frame,
  type FrameRole,
  type Size,
} from "@/lib/inputs/types";
import { currentMap, touchMap } from "./maps";
import { revealFrame } from "./reveal";
import { keepingSize } from "./sizeSync";
import { addFilesToInputs } from "./route";
import { forgetRemoval, recordRemoval } from "./trash";
import { offerUndo } from "./undo";
import { outlineOf } from "./outlineOf";

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

/** The frames a job was built from take the list's place, with their Size
 * from pick, at the frame size they were made at; what was there goes to the
 * trash. Returns what puts it back, at `previousSize`: the size from before
 * the restore began, which a restore of settings may already have changed.
 * Neither direction refits anything. */
export function restoreFrames(inputs: JobInputs, previousSize: Size): () => void {
  const store = useInputStore.getState();
  const previous = { frames: store.frames, sizeSource: store.sizeSource };
  keepingSize(() => {
    const inputStore = useInputStore.getState();
    inputStore.restoreFrames(inputs.frames);
    inputStore.setSizeSource(inputs.sizeSource);
    useGenerationStore.getState().setParams({ ...inputs.size });
  });
  let record: Promise<string | null> = Promise.resolve(null);
  if (previous.frames.some(holdsContent)) {
    const removal: Removal = {
      removedAt: Date.now(),
      from: { position: 1, frameId: previous.frames[0].id, role: previous.frames[0].role },
      content: { kind: "frames", frames: previous.frames },
    };
    record = recordRemoval(removal).catch((err: unknown) => {
      console.error("[inputs] could not keep what was removed", err);
      return null;
    });
  }
  return () => {
    keepingSize(() => {
      const inputStore = useInputStore.getState();
      inputStore.restoreFrames(previous.frames);
      inputStore.setSizeSource(previous.sizeSource);
      useGenerationStore.getState().setParams({ ...previousSize });
    });
    void record.then((key) => {
      if (key) forgetRemoval(key);
    });
  };
}

/** The map in the pictures' place: a composed frame's composition becomes
 * its map, drawn at the frame size so it fills the frame as before; a set
 * frame's pictures each become their map; the processor goes. Only current
 * maps are used; the frame as it was goes to the trash behind Undo. False
 * when no map was current or the frame changed while the map was drawn. */
export async function replaceWithMaps(env: OutlineEnv, frameId: string): Promise<boolean> {
  const { frames } = useInputStore.getState();
  const frame = frames.find((f) => f.id === frameId);
  const entry = outlineEntry(computeOutline(frames, env), frameId);
  if (!frame || !entry) return false;
  const mapName = (name: string) =>
    `${name.replace(/\.[^.]+$/, "")} (${frame.processor?.id ?? "map"}).png`;
  let apply: () => void;
  if (isComposed(frame.role)) {
    const slot = entry.maps[0];
    const map = slot?.state === "current" ? currentMap(slot.key) : null;
    if (!slot || !map || slot.spec.kind !== "composite") return false;
    const { width, height } = slot.spec;
    let file: Blob;
    try {
      file = await resizeBlob(map.blob, width, height);
    } catch (err) {
      toast.error("Could not replace the pictures with the map", {
        description: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
    touchMap(slot.key);
    // a linked Control frame's map is drawn from its source's pictures
    const source = frames.find((f) => f.id === (frame.link?.frameId ?? frame.id)) ?? frame;
    const name = mapName(composedPictures(source)[0]?.name ?? "picture");
    apply = () =>
      useInputStore.getState().replaceComposition(frameId, { file, name, width, height });
  } else {
    const maps = new Map<string, { file: Blob; name: string; width: number; height: number }>();
    for (const input of entry.sent) {
      const map = input.map?.state === "current" ? currentMap(input.map.key) : null;
      const picture = frame.pictures.find((p) => p.id === input.pictureId);
      if (!map || !picture || !input.map) continue;
      touchMap(input.map.key);
      maps.set(picture.id, {
        file: map.blob,
        name: mapName(picture.name),
        width: map.width,
        height: map.height,
      });
    }
    if (maps.size === 0) return false;
    apply = () => useInputStore.getState().replacePictures(frameId, maps);
  }
  if (useInputStore.getState().frames.find((f) => f.id === frameId) !== frame) {
    toast.info("Nothing replaced: the frame changed while the map was being drawn");
    return false;
  }
  const position = positionOf(frameId);
  const before = sentNow();
  // the map is drawn at the frame size, so the frame keeps its size both ways
  keepingSize(apply);
  const removal: Removal = {
    removedAt: Date.now(),
    from: { position, frameId, role: frame.role },
    content: { kind: "contents", frame },
  };
  void removed(
    removal,
    `${positionLabel(position)}: pictures replaced with their map`,
    renumberText(addressChanges(before, sentNow())),
    () => keepingSize(() => useInputStore.getState().restoreFrame(frame)),
  );
  return true;
}

/** One file in the place of a composed frame's pictures, fitted inside the
 * frame; the mask stays. The frame as it was goes to the trash behind Undo. */
export async function replacePicture(frameId: string, file: File): Promise<void> {
  const store = useInputStore.getState();
  const frame = store.frames.find((f) => f.id === frameId);
  if (!frame) return;
  const position = positionOf(frameId);
  const before = sentNow();
  for (const picture of frame.pictures) store.removePicture(frameId, picture.id);
  await addFilesToInputs([file], frameId);
  const removal: Removal = {
    removedAt: Date.now(),
    from: { position, frameId, role: frame.role },
    content: { kind: "contents", frame },
  };
  void removed(
    removal,
    `${positionLabel(position)}: picture replaced`,
    renumberText(addressChanges(before, sentNow())),
    () => useInputStore.getState().restoreFrame(frame),
  );
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
