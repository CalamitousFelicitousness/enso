// What a user does to the input list that is worth telling. Every removal
// writes a record the trash keeps for the retention period, riding on its
// undo step; every change that renumbers the sent pictures says which.

import { toast } from "sonner";
import { newId } from "@/lib/id";
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
import type { Inputs, Removal } from "@/lib/inputs/stored";
import {
  addedText,
  duplicatedText,
  inTrashText,
  NOT_KEPT_IN_TRASH,
  NOTHING_TO_DUPLICATE,
  positionLabel,
  renumberText,
  SHOW_TRASH,
} from "@/lib/inputs/text";
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
import { preparePictures } from "./route";
import { recordRemoval, trashRecord } from "./trash";
import { readTrashDays } from "./db";
import { showLibrary } from "./library";
import { isQuotaError, reportFull } from "./quota";
import { outlineOf } from "./outlineOf";
import { announce, attach, title, wait, type Announcement, type WaitHandle } from "@/undo/marks";
import { nameText } from "@/lib/undo/text";

const sentNow = (): SentInput[] => outlineOf(useInputStore.getState().frames).sent;

const positionOf = (frameId: string): number =>
  outlineEntry(outlineOf(useInputStore.getState().frames), frameId)?.position ?? 0;

const sizeNow = (): Size => {
  const { width, height } = useGenerationStore.getState();
  return { width, height };
};

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
  const [copy] = cloneFrames([frame], null, newId, "keep").frames;
  store.putBackFrame(copy, at + 1, []);
}

/** Put back what a removal took out, whatever the model's limit says: a
 * frame where it was with its links, a picture into its frame (else a new
 * frame of its role), a cleared frame's content into it (else the frame
 * whole), and each frame of a cleared list so. What a replace put aside comes
 * back beside what replaced it, and a replaced list takes the list's place
 * again, sending the list to the trash. */
export function putBack(removal: Removal): void {
  const { content, cause, size, from } = removal;
  if (content.kind === "frames" && cause === "replaced") {
    const now = sizeNow();
    restoreFrames({ frames: content.frames, size: size ?? now, sizeSource: content.sizeSource });
    return;
  }
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
}

/** A removal's record, written now: null when it could not be, which is said. */
function writeRecord(removal: Removal): Promise<string | null> {
  return recordRemoval(removal).catch((err: unknown) => {
    console.error("[inputs] could not keep what was removed", err);
    if (isQuotaError(err)) {
      // Undo still puts it back from its step
      toast.warning(NOT_KEPT_IN_TRASH);
      reportFull("A removed input");
    }
    return null;
  });
}

/** Keep a record of a removal on the step that made it. Called while the
 * step is being made. */
function keep(removal: Removal): Promise<string | null> {
  const written = writeRecord(removal);
  attach("images", trashRecord(removal, "after", written).command);
  return written;
}

/** Tell removals once their records are written, so a page closed right after
 * cannot lose both. */
function tell(
  notice: Announcement,
  kept: readonly Promise<string | null>[],
  text: string,
  renumber: string | null,
): void {
  void Promise.all(kept).then(async (keys) => {
    const inTrash = keys.some((key) => key !== null);
    const days = inTrash ? await readTrashDays().catch(() => null) : null;
    const retention = days === null ? null : inTrashText(days);
    notice.show(text, {
      description: [renumber, retention].filter(Boolean).join(". ") || null,
      ...(inTrash ? { also: { label: SHOW_TRASH, onClick: () => showLibrary("trash") } } : {}),
    });
  });
}

function removed(removal: Removal, text: string, renumber: string | null): void {
  tell(announce("images"), [keep(removal)], text, renumber);
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
  removed(
    removal,
    `${positionLabel(position)} removed`,
    renumberText(addressChanges(before, sentNow())),
  );
}

/** Remove one picture from a frame. */
/** Take a picture out of its frame; the removal, or null when it is not there. */
function takePicture(frameId: string, pictureId: string): Removal | null {
  const store = useInputStore.getState();
  const frame = store.frames.find((f) => f.id === frameId);
  const index = frame?.pictures.findIndex((p) => p.id === pictureId) ?? -1;
  if (!frame || index < 0) return null;
  const position = positionOf(frameId);
  store.removePicture(frameId, pictureId);
  return {
    removedAt: Date.now(),
    cause: "removed",
    size: sizeNow(),
    from: { position, frameId, role: frame.role },
    content: { kind: "picture", index, picture: frame.pictures[index] },
  };
}

export function removePicture(frameId: string, pictureId: string): void {
  const before = sentNow();
  const removal = takePicture(frameId, pictureId);
  if (removal?.content.kind !== "picture") return;
  removed(
    removal,
    `"${removal.content.picture.name}" removed from ${positionLabel(removal.from.position)}`,
    renumberText(addressChanges(before, sentNow())),
  );
}

/** Take out what is too large to send as one step with one notice: pictures
 * go to the trash, an IP-Adapter mask stays in the step. */
export function removeOversized(pictures: readonly { frameId: string; pictureId: string }[]): void {
  const name = { kind: "oversized removed" } as const;
  title(name);
  const notice = announce("images");
  const before = sentNow();
  const kept: Promise<string | null>[] = [];
  for (const { frameId, pictureId } of pictures) {
    const removal = takePicture(frameId, pictureId);
    if (removal) kept.push(keep(removal));
    else useInputStore.getState().removeIpMask(frameId, pictureId);
  }
  tell(notice, kept, nameText(name), renumberText(addressChanges(before, sentNow())));
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
  removed(
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
  removed(removal, "All inputs cleared", null);
}

/** Switch a frame on or off. False when the model's limit refused it. */
export function setFrameOn(frameId: string, on: boolean): boolean {
  const before = sentNow();
  if (!useInputStore.getState().setEnabled(frameId, on)) return false;
  const renumber = renumberText(addressChanges(before, sentNow()));
  if (renumber) {
    announce("images").show(`${positionLabel(positionOf(frameId))} ${on ? "on" : "off"}`, {
      description: renumber,
    });
  }
  return true;
}

export function moveFrame(from: number, to: number): void {
  const before = sentNow();
  useInputStore.getState().moveFrame(from, to);
  const renumber = renumberText(addressChanges(before, sentNow()));
  if (renumber) {
    announce("images").show(`${positionLabel(from + 1)} is now ${positionLabel(to + 1)}`, {
      description: renumber,
    });
  }
}

/** The frames a job was built from take the list's place, with their Size
 * from pick, at the frame size they were made at; what was there goes to the
 * trash, its record riding on the step being made. `previousSize` is the size
 * from before the action began, which a restore of settings may already have
 * changed. Nothing is refitted. */
export function restoreFrames(inputs: Inputs, previousSize: Size = sizeNow()): void {
  const store = useInputStore.getState();
  const previous = { frames: store.frames, sizeSource: store.sizeSource };
  keepingSize(() => {
    const inputStore = useInputStore.getState();
    inputStore.restoreFrames(inputs.frames);
    inputStore.setSizeSource(inputs.sizeSource);
    useGenerationStore.getState().setParams({ ...inputs.size });
  });
  if (!previous.frames.some(holdsContent)) return;
  const removal: Removal = {
    removedAt: Date.now(),
    cause: "replaced",
    size: { ...previousSize },
    from: { position: 1, frameId: previous.frames[0].id, role: previous.frames[0].role },
    content: { kind: "frames", frames: previous.frames, sizeSource: previous.sizeSource },
  };
  attach("images", trashRecord(removal, "after", writeRecord(removal)).command);
}

/** Land a change that waited, or make it now when nothing was awaited. */
function landing(waited: WaitHandle | null, fn: () => void): boolean {
  if (waited) return waited.land(fn);
  fn();
  return true;
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
  const position = positionOf(frameId);
  const mapName = (name: string) =>
    `${name.replace(/\.[^.]+$/, "")} (${frame.processor?.id ?? "map"}).png`;
  let apply: () => void;
  let waited: WaitHandle | null = null;
  if (isComposed(frame.role)) {
    const slot = entry.maps[0];
    const map = slot?.state === "current" ? currentMap(slot.key) : null;
    if (!slot || !map || slot.spec.kind !== "composite") return false;
    const { width, height } = slot.spec;
    waited = wait("images", { kind: "replace with maps", args: { frame: frameId, position } });
    let file: Blob;
    try {
      file = await resizeBlob(map.blob, width, height);
    } catch (err) {
      waited.end();
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
    waited?.end();
    toast.info("Nothing replaced: the frame changed while the map was being drawn");
    return false;
  }
  return landing(waited, () => {
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
    removed(
      removal,
      `${positionLabel(position)}: pictures replaced with their map`,
      renumberText(addressChanges(before, sentNow())),
    );
  });
}

/** One file in the place of a composed frame's pictures, fitted inside the
 * frame; the mask stays. The frame as it was goes to the trash, its record on
 * the step; a file refused or unreadable leaves it as it was. */
export async function replacePicture(frameId: string, file: File): Promise<void> {
  const waited = wait("images", {
    kind: "replace picture",
    args: { frame: frameId, position: positionOf(frameId) },
  });
  const [replacement] = await preparePictures([file]);
  const frame = useInputStore.getState().frames.find((f) => f.id === frameId);
  if (!replacement || !frame) {
    waited.end();
    return;
  }
  waited.land(() => {
    const store = useInputStore.getState();
    const position = positionOf(frameId);
    const before = sentNow();
    const size = sizeNow();
    for (const picture of frame.pictures) store.removePicture(frameId, picture.id);
    store.selectFrame(frameId);
    store.addPicture(frameId, replacement);
    const removal: Removal = {
      removedAt: Date.now(),
      cause: "replaced",
      size,
      from: { position, frameId, role: frame.role },
      content: { kind: "contents", frame },
    };
    removed(
      removal,
      `${positionLabel(position)}: picture replaced`,
      renumberText(addressChanges(before, sentNow())),
    );
  });
}

/** Add prepared frames after the inputs, or in the place of a blank list;
 * select the first and say where they went. Called while the step is being
 * made. False when the model's image limit refused them, which says so itself. */
export function addFrames(
  frames: Frame[],
  title: (positions: number[]) => string = addedText,
): boolean {
  if (frames.length === 0) return false;
  if (!useInputStore.getState().appendFrames(frames)) return false;
  const outline = outlineOf(useInputStore.getState().frames);
  const positions = frames.flatMap((f) => outlineEntry(outline, f.id)?.position ?? []);
  revealFrame(frames[0].id);
  announce("images").show(title(positions));
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
  const [copy] = cloneFrames([frame], null, newId, "keep").frames;
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
