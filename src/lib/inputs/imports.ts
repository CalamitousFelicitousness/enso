// Decides what to bring in from records older builds wrote. Each record is
// marked with a fingerprint of what was read, so it is imported once, and one
// an older build has changed since is offered again instead of merged unasked.

import type { ImportNote, LegacyImport } from "./legacy";
import { cloneFrames } from "./reducers";
import type { WorkingDocument } from "./stored";
import { hasMask, type Frame } from "./types";

/** One format of a body of legacy content. `fingerprint` is null while
 * storage holds no record of that format. */
export interface LegacySource {
  id: string;
  fingerprint: string | null;
}

/** A legacy record that storage holds. */
export interface LegacyRecord {
  id: string;
  fingerprint: string;
}

export interface ImportPlan {
  /** The record to import now. */
  load: LegacyRecord | null;
  /** Records to mark as seen without importing. */
  seen: LegacyRecord[];
  /** Records that changed after the content was imported. */
  offers: LegacyRecord[];
}

export const EMPTY_WORKING: WorkingDocument = {
  frames: [],
  selectedFrameId: null,
  activeItem: null,
  sizeSource: null,
  imports: {},
};

const isRecord = (source: LegacySource): source is LegacyRecord => source.fingerprint !== null;

/** What to do about the legacy records found. `lineage` lists the successive
 * formats of one body of content, newest first.
 *
 * On first contact the newest record found is imported and older ones are
 * marked as seen, because the newer record was made from them. After that
 * only the newest format is watched: when its record changes it is offered,
 * unless it holds what was already imported from an older format, which is
 * what an older build leaves behind by upgrading that record. */
export function planImports(imports: Record<string, string>, lineage: LegacySource[]): ImportPlan {
  const plan: ImportPlan = { load: null, seen: [], offers: [] };
  const [newest, ...older] = lineage.filter(isRecord);
  if (!newest) return plan;
  const marks = lineage.map((source) => imports[source.id]);
  if (marks.every((mark) => mark === undefined)) {
    plan.load = newest;
    plan.seen = older;
    return plan;
  }
  if (newest.id !== lineage[0].id || imports[newest.id] === newest.fingerprint) return plan;
  if (marks.includes(newest.fingerprint)) plan.seen = [newest];
  else plan.offers = [newest];
  return plan;
}

function marked(doc: WorkingDocument, records: LegacyRecord[]): WorkingDocument {
  if (records.length === 0) return doc;
  const marks = Object.fromEntries(records.map((r) => [r.id, r.fingerprint]));
  return { ...doc, imports: { ...doc.imports, ...marks } };
}

function idsOf(frames: Frame[]): string[] {
  return frames.flatMap((frame) => [
    frame.id,
    ...frame.pictures.map((p) => p.id),
    ...frame.mask.objects.map((m) => m.id),
  ]);
}

/** An import under new ids, for content the document already holds. Its
 * links to the document's own frames stay, as control units link to canvas
 * frames of another record. */
function reidentified(imported: LegacyImport, newId: () => string): LegacyImport {
  const clone = cloneFrames(imported.frames, imported.sizeSource, newId, "keep");
  const selected = imported.selectedFrameId && clone.frameIds.get(imported.selectedFrameId);
  return {
    ...imported,
    frames: clone.frames,
    sizeSource: clone.sizeSource,
    selectedFrameId: selected ?? null,
    activeItem: null,
  };
}

/** The document with the imported frames. They replace a document that holds
 * nothing (empty frames only), which also takes the import's selection and
 * size source; otherwise, and always with `keepFrames`, they follow the
 * document's own frames. Ids the document already uses are never repeated. */
function append(
  doc: WorkingDocument,
  imported: LegacyImport,
  newId: () => string,
  keepFrames: boolean,
): { doc: WorkingDocument; notes: ImportNote[] } {
  if (imported.frames.length === 0) return { doc, notes: imported.notes };
  const taken = new Set(idsOf(doc.frames));
  const incoming = idsOf(imported.frames).some((id) => taken.has(id))
    ? reidentified(imported, newId)
    : imported;
  const untouched = !keepFrames && doc.frames.every((f) => f.pictures.length === 0 && !hasMask(f));
  const kept = untouched ? [] : doc.frames;
  return {
    doc: {
      ...doc,
      frames: [...kept, ...incoming.frames],
      selectedFrameId: untouched ? incoming.selectedFrameId : doc.selectedFrameId,
      activeItem: untouched ? incoming.activeItem : doc.activeItem,
      sizeSource: untouched ? incoming.sizeSource : doc.sizeSource,
    },
    notes: incoming.notes.map((note) => ({ ...note, position: note.position + kept.length })),
  };
}

/** Carry out a plan. `loaded` is the converted content of `plan.load`, or
 * null when it could not be read; nothing is marked then, so the next load
 * tries again. The same document comes back when the plan changes nothing.
 * `keepFrames`: the import adds to the document's frames rather than
 * standing in for an empty document, as control units beside a canvas do. */
export function applyImports(
  doc: WorkingDocument,
  plan: ImportPlan,
  loaded: LegacyImport | null,
  newId: () => string,
  keepFrames = false,
): { doc: WorkingDocument; notes: ImportNote[] } {
  if (plan.load && !loaded) return { doc, notes: [] };
  const added = plan.load && loaded ? append(doc, loaded, newId, keepFrames) : { doc, notes: [] };
  const done = plan.load ? [plan.load, ...plan.seen] : plan.seen;
  return { doc: marked(added.doc, done), notes: added.notes };
}

/** Take up an offer: the record's frames join the document. */
export function acceptOffer(
  doc: WorkingDocument,
  offer: LegacyRecord,
  loaded: LegacyImport,
  newId: () => string,
  keepFrames = false,
): { doc: WorkingDocument; notes: ImportNote[] } {
  const added = append(doc, loaded, newId, keepFrames);
  return { doc: marked(added.doc, [offer]), notes: added.notes };
}

/** Turn an offer down: the record counts as seen until it changes again. */
export function declineOffer(doc: WorkingDocument, offer: LegacyRecord): WorkingDocument {
  return marked(doc, [offer]);
}
