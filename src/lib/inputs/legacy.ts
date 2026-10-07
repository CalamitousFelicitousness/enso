// Reads the canvas records written before the input document existed: the
// version 4 record (File and Blob handles) and the version 3 record (base64).
// Every item is converted on its own, so one bad entry costs that entry and a
// line in the notes, never the import.

import { base64ToBlob } from "@/lib/utils";
import { loose, type Loose } from "./loose";
import { newFrame } from "./reducers";
import type { SizeSourcePick } from "./outline";
import type { ActiveItem, Frame, MaskObject, MaskStroke, Picture, Transform } from "./types";

/** What an import did that the user would otherwise not see. `position` is
 * the frame's place in the imported list. */
export type ImportNote =
  /** Pictures kept from the frame's other mode, hidden until a role switch. */
  | { kind: "otherMode"; position: number; count: number }
  | { kind: "unreadablePicture"; position: number; name: string }
  | { kind: "unreadableMask"; position: number; count: number }
  /** Entries that were not a picture, a mask or a stroke this build knows. */
  | { kind: "skipped"; position: number; count: number }
  /** A control unit that was on arrives switched off: it was never sent (its
   * picture was the canvas), or its kind no longer exists. */
  | { kind: "controlOff"; position: number; reason: "neverSent" | "retiredType" }
  /** A control unit borrowed its picture from a unit that has none; it arrives without one. */
  | { kind: "controlUnlinked"; position: number }
  /** A processed preview was made from the raw file, so it is not carried
   * over; the map is made again when the frame is sent. */
  | { kind: "previewDropped"; position: number }
  /** A processor kept from the frame's Control role, which did nothing in its
   * present role, is not carried over. */
  | { kind: "processorDropped"; position: number; processor: string };

export interface LegacyImport {
  frames: Frame[];
  selectedFrameId: string | null;
  activeItem: ActiveItem | null;
  sizeSource: SizeSourcePick | null;
  notes: ImportNote[];
}

/** Field names of the legacy records. An image layer, a mask layer and a
 * reference share one loose shape; each reader takes the fields it knows. */
interface LegacyEntry {
  id: string;
  type: string;
  name: string;
  filename: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
  file: Blob;
  blob: Blob;
  base64: string;
  naturalWidth: number;
  naturalHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

interface LegacyFrame {
  id: string;
  mode: string;
  layers: unknown[];
  activeLayerId: string | null;
  maskLines: unknown[];
  references: unknown[];
}

interface LegacyState {
  inputFrames: unknown[];
  activeInputFrameId: string | null;
  sizeSource: { frameId: string; refId: string | null } | null;
}

type Entry = Loose<LegacyEntry>;

const isText = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const items = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const numberOr = (v: unknown, fallback: number) => (isNum(v) ? v : fallback);
const textOr = (v: unknown, fallback: string) => (isText(v) && v !== "" ? v : fallback);

interface Bytes {
  blob: Blob | null;
  /** Equal for two entries that hold the same bytes, as they do when a mode
   * switch copied one from the other; null when that cannot be told. */
  signature: string | null;
}

/** A layer's or reference's bytes: a handle (version 4) or base64 (version 3).
 * No blob when neither is there or the base64 does not decode. */
function bytesOf(entry: Entry, field: "file" | "blob"): Bytes {
  const handle = entry[field];
  if (handle instanceof Blob) {
    const named = handle as Partial<File>;
    const parts = [named.name ?? "", handle.size, named.lastModified ?? 0, handle.type];
    return { blob: handle, signature: `file:${parts.join("|")}` };
  }
  if (!isText(entry.base64) || entry.base64 === "") return { blob: null, signature: null };
  try {
    const blob = base64ToBlob(entry.base64);
    return { blob, signature: `base64:${entry.base64.length}:${textHash(entry.base64)}` };
  } catch {
    return { blob: null, signature: null };
  }
}

function transformOf(entry: Entry): Transform {
  return {
    x: numberOr(entry.x, 0),
    y: numberOr(entry.y, 0),
    scaleX: numberOr(entry.scaleX, 1),
    scaleY: numberOr(entry.scaleY, 1),
    rotation: numberOr(entry.rotation, 0),
  };
}

interface Converted {
  picture: Picture;
  signature: string | null;
}

function layerPicture(layer: Entry, id: string, newCid: () => string): Converted {
  const { blob: file, signature } = bytesOf(layer, "file");
  const width = numberOr(layer.naturalWidth, 0);
  const height = numberOr(layer.naturalHeight, 0);
  return {
    signature,
    picture: {
      id,
      cid: newCid(),
      file,
      name: textOr(layer.name, "image.png"),
      media: "image",
      width,
      height,
      visible: layer.visible !== false,
      hiddenBySwitch: false,
      locked: layer.locked === true,
      opacity: numberOr(layer.opacity, 1),
      transform: transformOf(layer),
    },
  };
}

function referencePicture(reference: Entry, id: string, newCid: () => string): Converted {
  const { blob: file, signature } = bytesOf(reference, "file");
  const width = numberOr(reference.naturalWidth, 0);
  const height = numberOr(reference.naturalHeight, 0);
  return {
    signature,
    picture: {
      id,
      cid: newCid(),
      file,
      name: textOr(reference.filename, "reference.png"),
      media: "image",
      width,
      height,
      visible: true,
      hiddenBySwitch: false,
      locked: false,
      opacity: 1,
      transform: null,
    },
  };
}

function maskObject(layer: Entry, id: string, blob: Blob, newCid: () => string): MaskObject {
  return {
    id,
    cid: newCid(),
    blob,
    name: textOr(layer.name, "Mask"),
    visible: layer.visible !== false,
    locked: layer.locked !== false,
    width: numberOr(layer.width, 0),
    height: numberOr(layer.height, 0),
    transform: transformOf(layer),
  };
}

function stroke(value: unknown): MaskStroke | null {
  const line = loose<MaskStroke>(value);
  if (!line || !Array.isArray(line.points) || !line.points.every(isNum)) return null;
  if (!isNum(line.strokeWidth) || (line.tool !== "brush" && line.tool !== "eraser")) return null;
  return { points: line.points, strokeWidth: line.strokeWidth, tool: line.tool };
}

/** The frame's two arms as one picture list. The active arm leads; a picture
 * found in both (one was copied from the other on a mode switch) is kept
 * once, with the layer's placement; the rest of the other arm follows,
 * hidden until a role switch. */
function mergeArms(
  role: Frame["role"],
  layers: Converted[],
  references: Converted[],
  renamed: Map<string, string>,
): { pictures: Picture[]; otherMode: number } {
  const [active, other] = role === "initial" ? [layers, references] : [references, layers];
  const taken = new Set<Converted>();
  const twinOf = (entry: Converted) =>
    other.find(
      (o) =>
        !taken.has(o) &&
        o.signature !== null &&
        o.signature === entry.signature &&
        // a hidden layer is not what its reference shows
        (role === "initial" ? entry.picture.visible : o.picture.visible),
    );
  const pictures = active.map((entry) => {
    const twin = twinOf(entry);
    if (!twin) return entry.picture;
    taken.add(twin);
    renamed.set(twin.picture.id, entry.picture.id);
    const layer = role === "initial" ? entry.picture : twin.picture;
    return { ...entry.picture, transform: layer.transform, opacity: layer.opacity };
  });
  const rest = other.filter((o) => !taken.has(o)).map((o) => o.picture);
  const hidden = rest.map((p) => (p.visible ? { ...p, visible: false, hiddenBySwitch: true } : p));
  return { pictures: [...pictures, ...hidden], otherMode: hidden.length };
}

/** Frames from a legacy canvas record's state. `newCid` names each imported
 * Blob. Never throws: what cannot be converted is noted and left out. */
export function legacyToFrames(state: unknown, newCid: () => string): LegacyImport {
  const notes: ImportNote[] = [];
  const renamed = new Map<string, string>();
  const frames: Frame[] = [];
  const activeLayers = new Map<string, string>();
  const source = loose<LegacyState>(state) ?? {};

  for (const value of items(source.inputFrames)) {
    const entry = loose<LegacyFrame>(value);
    if (!entry || !isText(entry.id)) continue;
    const position = frames.length + 1;
    const role = entry.mode === "reference" ? "reference" : "initial";
    const layers: Converted[] = [];
    const objects: MaskObject[] = [];
    let skipped = 0;
    let unreadableMasks = 0;

    for (const item of items(entry.layers)) {
      const layer = loose<LegacyEntry>(item);
      if (!layer || !isText(layer.id)) skipped += 1;
      else if (layer.type === "image") layers.push(layerPicture(layer, layer.id, newCid));
      else if (layer.type === "mask") {
        const { blob } = bytesOf(layer, "blob");
        if (blob) objects.push(maskObject(layer, layer.id, blob, newCid));
        else unreadableMasks += 1;
      } else skipped += 1;
    }
    const references: Converted[] = [];
    for (const item of items(entry.references)) {
      const reference = loose<LegacyEntry>(item);
      if (!reference || !isText(reference.id)) skipped += 1;
      else references.push(referencePicture(reference, reference.id, newCid));
    }
    const strokes: MaskStroke[] = [];
    for (const line of items(entry.maskLines)) {
      const converted = stroke(line);
      if (converted) strokes.push(converted);
      else skipped += 1;
    }

    const { pictures, otherMode } = mergeArms(role, layers, references, renamed);
    frames.push({ ...newFrame(entry.id, role), pictures, mask: { objects, strokes } });
    if (isText(entry.activeLayerId)) activeLayers.set(entry.id, entry.activeLayerId);

    if (otherMode > 0) notes.push({ kind: "otherMode", position, count: otherMode });
    for (const picture of pictures) {
      if (!picture.file) notes.push({ kind: "unreadablePicture", position, name: picture.name });
    }
    if (unreadableMasks > 0) {
      notes.push({ kind: "unreadableMask", position, count: unreadableMasks });
    }
    if (skipped > 0) notes.push({ kind: "skipped", position, count: skipped });
  }

  const selected = frames.find((f) => f.id === source.activeInputFrameId) ?? frames[0];
  const activeId = selected && activeLayers.get(selected.id);
  const activeItem =
    selected && activeId !== undefined
      ? [...selected.pictures, ...selected.mask.objects].find(
          (item) => item.id === (renamed.get(activeId) ?? activeId),
        )
      : undefined;

  const pick = loose<NonNullable<LegacyState["sizeSource"]>>(source.sizeSource);
  const pickFrame = pick && frames.find((f) => f.id === pick.frameId);
  const pickedId = pick && isText(pick.refId) ? (renamed.get(pick.refId) ?? pick.refId) : null;

  return {
    frames,
    selectedFrameId: selected?.id ?? null,
    activeItem: selected && activeItem ? { frameId: selected.id, id: activeItem.id } : null,
    sizeSource: pickFrame ? { frameId: pickFrame.id, pictureId: pickedId } : null,
    notes,
  };
}

/** FNV-1a over the text, as eight hex digits. */
export function textHash(text: string): string {
  // FNV-1a, 32 bit
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Identifies what a legacy record holds by the ids of its frames, pictures
 * and masks and by its stroke counts. Moving a layer or panning the canvas
 * leaves it unchanged, and so does rewriting the record in another format;
 * it differs once an older build has added, removed or replaced content,
 * each of which makes or drops an id. */
export function legacyFingerprint(state: unknown): string {
  const source = loose<LegacyState>(state) ?? {};
  const entryKey = (value: unknown) => textOr(loose<LegacyEntry>(value)?.id, "?");
  const parts = items(source.inputFrames).map((value) => {
    const frame = loose<LegacyFrame>(value);
    if (!frame) return "?";
    return [
      textOr(frame.id, "?"),
      textOr(frame.mode, "?"),
      items(frame.layers).map(entryKey).join(","),
      items(frame.references).map(entryKey).join(","),
      items(frame.maskLines).length,
    ].join(";");
  });
  return textHash(parts.join("\n"));
}
