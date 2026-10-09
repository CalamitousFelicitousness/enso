// What a user does to the input list that is worth telling and undoing. Every
// removal writes a record the trash keeps for the retention period and offers
// Undo; every change that renumbers the sent pictures says which.

import { toast } from "sonner";
import { useGenerationStore } from "@/stores/generationStore";
import { useInputStore, type NewMap } from "@/stores/inputStore";
import { resizeBlob } from "@/lib/resize";
import {
  computeOutline,
  outlineEntry,
  type OutlineEnv,
  type SentInput,
} from "@/lib/inputs/outline";
import { refitFrame } from "@/lib/inputs/geometry";
import { cloneFrames, isBlank, newFrame } from "@/lib/inputs/reducers";
import { addressChanges } from "@/lib/inputs/renumber";
import { removalCids, type Inputs, type Removal } from "@/lib/inputs/stored";
import {
  addedText,
  duplicatedText,
  NOT_KEPT_IN_TRASH,
  NOTHING_TO_DUPLICATE,
  positionLabel,
  renumberText,
} from "@/lib/inputs/text";
import {
  cidsOf,
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
import { isQuotaError, reportFull } from "./quota";
import { offerUndo } from "./undo";
import { outlineOf } from "./outlineOf";

const sentNow = (): SentInput[] => outlineOf(useInputStore.getState().frames).sent;

const positionOf = (frameId: string): number =>
  outlineEntry(outlineOf(useInputStore.getState().frames), frameId)?.position ?? 0;

const sizeNow = (): Size => {
  const { width, height } = useGenerationStore.getState();
  return { width, height };
};

/** What undoes a change, and the frames it would bring back, whose bytes
 * must stay while it can. */
export interface Inverse {
  run: () => void;
  frames: readonly Frame[];
}

/** An Undo offer for an inverse, holding the bytes of what it brings back. */
export function offerInverse(
  title: string,
  description: string | null,
  inverse: Inverse,
  settle?: () => void,
): void {
  offerUndo(title, description, inverse.run, {
    holds: () => cidsOf(inverse.frames),
    ...(settle ? { settle } : {}),
  });
}

/** Put a frame back where it was, or its content into the frame that took its place. */
function putBackFrame(frame: Frame, index: number, linkedFrom: string[] = []): void {
  const store = useInputStore.getState();
  if (store.frames.some((f) => f.id === frame.id)) store.mergeContent(frame.id, frame);
  else store.putBackFrame(frame, index, linkedFrom);
}

/** A frame back in a document whose frame size changed since it left,
 * refitted the way a change of frame size refits every frame. */
function sized(frame: Frame, from: Size | null): Frame {
  const now = sizeNow();
  const changed = from !== null && (from.width !== now.width || from.height !== now.height);
  return changed ? refitFrame(frame, now) : frame;
}

/** A frame a replace put aside, back beside the frame that replaced it, under new ids. */
function putBeside(frame: Frame, index: number): void {
  const store = useInputStore.getState();
  const at = store.frames.findIndex((f) => f.id === frame.id);
  if (at < 0) {
    store.putBackFrame(frame, index, []);
    return;
  }
  const [copy] = cloneFrames([frame], null, () => crypto.randomUUID(), "keep").frames;
  store.putBackFrame(copy, at + 1, []);
}

/** What puts the list, its Size from pick and the frame size back as they are now. */
function holdList(): Inverse {
  const { frames, sizeSource } = useInputStore.getState();
  const size = sizeNow();
  return {
    frames,
    run: () =>
      keepingSize(() => {
        const store = useInputStore.getState();
        store.restoreFrames(frames);
        store.setSizeSource(sizeSource);
        useGenerationStore.getState().setParams({ ...size });
      }),
  };
}

/** Put back what a removal took out, whatever the model's limit says: a
 * frame where it was with its links, a picture into its frame (else a new
 * frame of its role), a cleared frame's content into it (else the frame
 * whole), and each frame of a cleared list so. What a replace put aside comes
 * back beside what replaced it, and a replaced list takes the list's place
 * again, sending the list to the trash. Returns what undoes the put-back. */
export function putBack(removal: Removal): Inverse {
  const { content, cause, size, from } = removal;
  if (content.kind === "frames" && cause === "replaced") {
    const now = sizeNow();
    const inputs = { frames: content.frames, size: size ?? now, sizeSource: content.sizeSource };
    return restoreFrames(inputs, now);
  }
  const undo = holdList();
  const at = from.position - 1;
  switch (content.kind) {
    case "frame":
      putBackFrame(sized(content.frame, size), content.index, content.linkedFrom);
      break;
    case "picture": {
      const store = useInputStore.getState();
      const owner = store.frames.find((f) => f.id === from.frameId);
      const holder = sized(
        {
          ...(owner ?? newFrame(from.frameId, from.role)),
          pictures: [content.picture],
          mask: { objects: [], strokes: [] },
        },
        size,
      );
      if (owner) store.insertPicture(owner.id, holder.pictures[0], content.index);
      else putBackFrame(holder, at);
      break;
    }
    case "contents":
      if (cause === "replaced") putBeside(sized(content.frame, size), at);
      else putBackFrame(sized(content.frame, size), at);
      break;
    case "frames":
      content.frames.forEach((frame, index) => putBackFrame(sized(frame, size), index));
      break;
  }
  return undo;
}

/** Keep a record of the removal, tell it, and offer to undo it: by putting
 * back what it took out, unless the change has an inverse of its own. The
 * notice waits for the record, so a page closed right after cannot lose both. */
async function removed(
  removal: Removal,
  title: string,
  renumber: string | null,
  undo: () => void = () => {
    putBack(removal);
  },
): Promise<void> {
  let key: string | null = null;
  try {
    key = await recordRemoval(removal);
  } catch (err) {
    console.error("[inputs] could not keep what was removed", err);
    if (isQuotaError(err)) {
      // Undo still puts it back from memory
      toast.warning(NOT_KEPT_IN_TRASH);
      reportFull("A removed input");
    }
  }
  offerUndo(
    title,
    renumber,
    () => {
      undo();
      if (key) void forgetRemoval(key);
    },
    { holds: () => removalCids(removal) },
  );
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
    cause: "removed",
    size: sizeNow(),
    from: { position, frameId, role: frame.role },
    content: { kind: "frame", index, frame, linkedFrom },
  };
  void removed(
    removal,
    `${positionLabel(position)} removed`,
    renumberText(addressChanges(before, sentNow())),
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
    cause: "removed",
    size: sizeNow(),
    from: { position, frameId, role: frame.role },
    content: { kind: "picture", index, picture },
  };
  void removed(
    removal,
    `"${picture.name}" removed from ${positionLabel(position)}`,
    renumberText(addressChanges(before, sentNow())),
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
    cause: "cleared",
    size: sizeNow(),
    from: { position, frameId, role: frame.role },
    content: { kind: "contents", frame },
  };
  void removed(
    removal,
    `${positionLabel(position)} cleared`,
    renumberText(addressChanges(before, sentNow())),
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
    cause: "cleared",
    size: sizeNow(),
    from: { position: 1, frameId: frames[0].id, role: frames[0].role },
    content: { kind: "frames", frames, sizeSource: store.sizeSource },
  };
  void removed(removal, "All inputs cleared", null);
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
export function restoreFrames(inputs: Inputs, previousSize: Size): Inverse {
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
      cause: "replaced",
      size: { ...previousSize },
      from: { position: 1, frameId: previous.frames[0].id, role: previous.frames[0].role },
      content: { kind: "frames", frames: previous.frames, sizeSource: previous.sizeSource },
    };
    record = recordRemoval(removal).catch((err: unknown) => {
      console.error("[inputs] could not keep what was removed", err);
      return null;
    });
  }
  return {
    frames: previous.frames,
    run: () => {
      keepingSize(() => {
        const inputStore = useInputStore.getState();
        inputStore.restoreFrames(previous.frames);
        inputStore.setSizeSource(previous.sizeSource);
        useGenerationStore.getState().setParams({ ...previousSize });
      });
      void record.then((key) => {
        if (key) void forgetRemoval(key);
      });
    },
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
    // bytes the resize left as they were are already stored under the map's cid
    const cid = file === map.blob ? { cid: map.cid } : {};
    apply = () =>
      useInputStore.getState().replaceComposition(frameId, { file, name, width, height, ...cid });
  } else {
    const maps = new Map<string, NewMap>();
    for (const input of entry.sent) {
      const map = input.map?.state === "current" ? currentMap(input.map.key) : null;
      const picture = frame.pictures.find((p) => p.id === input.pictureId);
      if (!map || !picture || !input.map) continue;
      touchMap(input.map.key);
      maps.set(picture.id, {
        file: map.blob,
        cid: map.cid,
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
    cause: "replaced",
    size: sizeNow(),
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
  const size = sizeNow();
  for (const picture of frame.pictures) store.removePicture(frameId, picture.id);
  await addFilesToInputs([file], frameId);
  const removal: Removal = {
    removedAt: Date.now(),
    cause: "replaced",
    size,
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

/** Add prepared frames after the inputs, or in the place of a blank list;
 * select the first and say where they went, with Undo. False when the
 * model's image limit refused them, which says so itself. */
export function addFrames(
  frames: Frame[],
  title: (positions: number[]) => string = addedText,
): boolean {
  if (frames.length === 0) return false;
  const store = useInputStore.getState();
  const undo: Inverse = store.frames.every(isBlank)
    ? holdList()
    : {
        frames: [],
        run: () => {
          const current = useInputStore.getState();
          for (const frame of frames) current.removeFrame(frame.id);
        },
      };
  if (!store.appendFrames(frames)) return false;
  const outline = outlineOf(useInputStore.getState().frames);
  const positions = frames.flatMap((f) => outlineEntry(outline, f.id)?.position ?? []);
  revealFrame(frames[0].id);
  offerInverse(title(positions), null, undo);
  return true;
}

/** A copy of a frame after the last one, under new ids and keeping its link,
 * with Undo. False when there was nothing to copy or the model's limit refused it. */
export function duplicateFrame(frameId: string): boolean {
  const frame = useInputStore.getState().frames.find((f) => f.id === frameId);
  if (!frame) return false;
  if (isBlank(frame)) {
    toast.info(NOTHING_TO_DUPLICATE);
    return false;
  }
  const from = positionOf(frameId);
  const [copy] = cloneFrames([frame], null, () => crypto.randomUUID(), "keep").frames;
  return addFrames([copy], ([to]) => duplicatedText(from, to ?? from + 1));
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
