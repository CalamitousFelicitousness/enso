// Where the input store's working document is kept: one record in the
// enso-inputs database, its pictures beside it. Reading it also brings in
// what builds before the input document left in the canvas record.

import type { StorageValue } from "zustand/middleware";
import { createGatedStorage, idbBackend, type KeyValueBackend } from "@/lib/idbStorage";
import { applyImports, EMPTY_WORKING, planImports, type LegacyRecord } from "@/lib/inputs/imports";
import {
  legacyFingerprint,
  legacyToFrames,
  type ImportNote,
  type LegacyImport,
} from "@/lib/inputs/legacy";
import { REFERENCE_HEIGHT } from "@/lib/inputs/layout";
import { controlFingerprint, controlToFrames, readLegacyControl } from "@/lib/inputs/legacyControl";
import { loose } from "@/lib/inputs/loose";
import {
  joinWorking,
  readWorking,
  splitWorking,
  type JoinLoss,
  type WorkingDocument,
} from "@/lib/inputs/stored";
import { DOCUMENTS } from "@/lib/inputs/storeLayout";
import { useGenerationStore } from "@/stores/generationStore";
import {
  DocumentConflict,
  deleteDocument,
  enterTab,
  latestRevision,
  readDocument,
  unreadableBlobs,
  writeDocument,
} from "./db";
import { decodeLegacyUnits } from "./legacyControl";

/** What reading the stored inputs turned up besides the document. */
export interface HydrationFindings {
  lost: JoinLoss;
  notes: ImportNote[];
  offers: LegacyRecord[];
  /** A record of an older build is there and could not be brought in. It is
   * tried again on the next page load. */
  legacyUnread: boolean;
}

/** What the store hydrates from. Without a stored document `findings` comes alone. */
export type PersistedInputs = Partial<WorkingDocument> & { findings?: HydrationFindings };

/** A write failed because these blobs can no longer be read. */
export class UnreadableBlobs extends Error {
  override name = "UnreadableBlobs";
  readonly cids: string[];
  constructor(cids: string[], cause: unknown) {
    super(`${cids.length} stored picture(s) can no longer be read`, { cause });
    this.cids = cids;
  }
}

/** The document holds a value its own reader would refuse, so it was not
 * written: the stored one stays readable. */
export class UnstorableDocument extends Error {
  override name = "UnstorableDocument";
}

/** The canvas record's formats, newest first. Version 3 is a JSON string. */
const LEGACY = [
  { id: "canvas-v4", key: "enso-canvas-v4", version: 4 },
  { id: "canvas-v3", key: "enso-canvas", version: 3 },
] as const;

const legacyCanvas = idbBackend("enso-canvas", "state");

interface FoundSource {
  id: string;
  /** Null when storage holds no record of this format. */
  fingerprint: string | null;
  /** The record's state, when it was read to be fingerprinted. */
  state?: unknown;
}

/** The state of a legacy record of the version its key should hold, else null. */
function stateOf(raw: unknown, version: number): unknown {
  const stored = loose<StorageValue<unknown>>(typeof raw === "string" ? JSON.parse(raw) : raw);
  return stored?.version === version ? (stored.state ?? null) : null;
}

/** Every format of the legacy canvas record, newest first, with a fingerprint
 * for those storage holds. A record stored as text is parsed only while it
 * could still be the one to import: nothing imported yet and no newer record.
 * After that it is not watched, and stands for itself. */
async function findSources(imports: Record<string, string>): Promise<FoundSource[]> {
  const known = LEGACY.some((format) => imports[format.id] !== undefined);
  const sources: FoundSource[] = [];
  let newerFound = false;
  for (const { id, key, version } of LEGACY) {
    const raw = await legacyCanvas.get(key);
    if (raw === null || raw === undefined) {
      sources.push({ id, fingerprint: null });
    } else if (typeof raw === "string" && (known || newerFound)) {
      sources.push({ id, fingerprint: "unread" });
    } else {
      const state = stateOf(raw, version);
      sources.push({ id, fingerprint: legacyFingerprint(state), state });
    }
    newerFound ||= raw !== null && raw !== undefined;
  }
  return sources;
}

interface LegacyBytes {
  file: unknown;
  blob: unknown;
}

/** The state with every Blob that can no longer be read replaced by its size
 * alone, so the import records it as unreadable instead of failing on it. */
async function withoutDeadBlobs(state: unknown): Promise<unknown> {
  const frames = loose<{ inputFrames: unknown }>(state)?.inputFrames;
  if (!Array.isArray(frames)) return state;
  const readable = async (value: unknown) => {
    if (!(value instanceof Blob)) return value;
    try {
      await value.slice(0, 1).arrayBuffer();
      return value;
    } catch {
      return { size: value.size };
    }
  };
  const checked = (entries: unknown) =>
    Promise.all(
      (Array.isArray(entries) ? entries : []).map(async (entry: unknown) => {
        const bytes = loose<LegacyBytes>(entry);
        if (!bytes) return entry;
        return { ...bytes, file: await readable(bytes.file), blob: await readable(bytes.blob) };
      }),
    );
  const inputFrames = await Promise.all(
    frames.map(async (frame: unknown) => {
      const arms = loose<{ layers: unknown; references: unknown }>(frame);
      if (!arms) return frame;
      return {
        ...arms,
        layers: await checked(arms.layers),
        references: await checked(arms.references),
      };
    }),
  );
  return { ...loose<object>(state), inputFrames };
}

async function convert(source: FoundSource): Promise<LegacyImport> {
  return legacyToFrames(await withoutDeadBlobs(source.state), () => crypto.randomUUID());
}

/** The control units record older builds kept beside the canvas: one format. */
const CONTROL_SOURCE = "control-v1";
const legacyControl = idbBackend("enso-control", "state");

async function findControlSource(): Promise<FoundSource> {
  const raw = await legacyControl.get("units");
  if (raw === null || raw === undefined) return { id: CONTROL_SOURCE, fingerprint: null };
  return { id: CONTROL_SOURCE, fingerprint: controlFingerprint(raw), state: raw };
}

/** Control and IP-Adapter frames from the units record, placed against the
 * current frame size; units that took the canvas as their picture link to
 * the document's first Initial frame. */
async function convertControl(source: FoundSource, doc: WorkingDocument): Promise<LegacyImport> {
  const units = await decodeLegacyUnits(readLegacyControl(source.state));
  const { width, height } = useGenerationStore.getState();
  const { frames, notes } = controlToFrames(
    units,
    {
      size: { width, height },
      displayHeight: REFERENCE_HEIGHT,
      initialFrameId: doc.frames.find((f) => f.role === "initial")?.id ?? null,
    },
    () => crypto.randomUUID(),
    () => crypto.randomUUID(),
  );
  return { frames, notes, selectedFrameId: null, activeItem: null, sizeSource: null };
}

/** Whether an offer's frames join the document's own frames rather than
 * stand in for an empty document. */
export function keepsFrames(offer: LegacyRecord): boolean {
  return offer.id === CONTROL_SOURCE;
}

/** The frames a legacy record holds now, for an offer the user takes up. Null
 * when the record is gone or no longer the one offered. */
export async function loadOffer(
  offer: LegacyRecord,
  doc: WorkingDocument,
): Promise<LegacyImport | null> {
  if (offer.id === CONTROL_SOURCE) {
    const source = await findControlSource();
    return source.fingerprint === offer.fingerprint ? convertControl(source, doc) : null;
  }
  const source = (await findSources({})).find((s) => s.id === offer.id);
  return source?.fingerprint === offer.fingerprint ? convert(source) : null;
}

/** Marks for every legacy record there is, as if each had been imported. For
 * a document started empty on purpose, which should stay empty. */
export async function legacyMarks(): Promise<Record<string, string>> {
  try {
    const found = [...(await findSources({})), await findControlSource()];
    return Object.fromEntries(
      found.flatMap((s) => (s.fingerprint === null ? [] : [[s.id, s.fingerprint]])),
    );
  } catch {
    return {};
  }
}

const KEY = "working";

/** The revision of the stored document this tab last read or wrote. */
let revision = 0;

async function store(doc: WorkingDocument): Promise<void> {
  const { record, blobs } = splitWorking(doc, revision + 1);
  try {
    // what this build would refuse to read back must not replace what it can
    readWorking(record);
  } catch (cause) {
    throw new UnstorableDocument("the inputs hold a value that cannot be stored", { cause });
  }
  try {
    await writeDocument(DOCUMENTS, KEY, record, blobs, revision + 1);
  } catch (err) {
    if (err instanceof DocumentConflict) throw err;
    const dead = await unreadableBlobs(blobs);
    throw dead.length > 0 ? new UnreadableBlobs(dead, err) : err;
  }
  revision += 1;
}

/** Take the stored document's place after another tab wrote it: the next
 * write replaces theirs. */
export async function overruleOtherTab(): Promise<void> {
  revision = await latestRevision(DOCUMENTS, KEY);
}

/** Bring in what older builds left. A failure to read their record changes
 * nothing and is reported, so the import is tried again on the next load. */
async function importLegacy(
  doc: WorkingDocument,
): Promise<{ doc: WorkingDocument; notes: ImportNote[]; offers: LegacyRecord[]; unread: boolean }> {
  try {
    const newId = () => crypto.randomUUID();
    const sources = await findSources(doc.imports);
    const plan = planImports(doc.imports, sources);
    const found = plan.load && sources.find((s) => s.id === plan.load?.id);
    const canvas = applyImports(doc, plan, found ? await convert(found) : null, newId);
    // Control units had a record of their own; their frames join the canvas frames
    const control = await findControlSource();
    const controlPlan = planImports(canvas.doc.imports, [control]);
    const loaded = controlPlan.load ? await convertControl(control, canvas.doc) : null;
    const applied = applyImports(canvas.doc, controlPlan, loaded, newId, true);
    return {
      doc: applied.doc,
      notes: [...canvas.notes, ...applied.notes],
      offers: [...plan.offers, ...controlPlan.offers],
      unread: false,
    };
  } catch (err) {
    console.error("[inputs] the canvas record of an older build could not be read", err);
    return { doc, notes: [], offers: [], unread: true };
  }
}

const NO_LOSS: JoinLoss = { pictures: [], maskObjects: 0 };

const backend: KeyValueBackend = {
  async get() {
    await enterTab();
    const stored = await readDocument(DOCUMENTS, KEY, readWorking, (read) => read.cids);
    const own = stored ? joinWorking(stored.document.record, stored.blobs) : null;
    revision = stored ? stored.document.record.revision : await latestRevision(DOCUMENTS, KEY);
    const before = own?.doc ?? EMPTY_WORKING;
    let imported = await importLegacy(before);
    const lost = own?.lost ?? NO_LOSS;
    const upgraded = stored?.document.notes ?? [];
    // An import is stored before the store may write, so a reload cannot find
    // the frames without their marks or the marks without their frames. A
    // loss or an upgrade is stored too, or it would be reported on every load.
    if (
      imported.doc !== before ||
      lost.pictures.length > 0 ||
      lost.maskObjects > 0 ||
      upgraded.length > 0
    ) {
      try {
        await store(imported.doc);
      } catch (err) {
        // The stored document was read; only this write failed. Go on with
        // what was read, and let the next load try the import again.
        console.error("[inputs] could not store what loading found", err);
        imported = {
          doc: before,
          notes: [],
          offers: imported.offers,
          unread: imported.doc !== before,
        };
      }
    }
    const findings: HydrationFindings = {
      lost,
      notes: [...upgraded, ...imported.notes],
      offers: imported.offers,
      legacyUnread: imported.unread,
    };
    const state: PersistedInputs =
      own || imported.doc !== before ? { ...imported.doc, findings } : { findings };
    return { state, version: 0 } satisfies StorageValue<PersistedInputs>;
  },
  set: (_key, value) => store((value as StorageValue<WorkingDocument>).state),
  delete: () => deleteDocument(DOCUMENTS, KEY),
};

export function createInputsStorage(
  onWriteError: (error: unknown) => void,
  onWriteRecovered: () => void,
) {
  return createGatedStorage<PersistedInputs>(backend, "enso-inputs/documents", {
    onWriteError,
    onWriteRecovered,
    // every change makes new objects, so the same objects are the same record
    same: (a, b) =>
      a.frames === b.frames &&
      a.selectedFrameId === b.selectedFrameId &&
      a.activeItem === b.activeItem &&
      a.sizeSource === b.sizeSource &&
      a.imports === b.imports,
  });
}
