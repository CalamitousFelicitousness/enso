import { create } from "zustand";
import { persist } from "zustand/middleware";
import { RECORD } from "@/lib/profile/names";
import { newId } from "@/lib/id";
import { useGenerationStore } from "@/stores/generationStore";
import { reportStorageProblem } from "@/lib/storageHealth";
import { exceedsLimit } from "@/lib/inputs/capacity";
import { refitFrame } from "@/lib/inputs/geometry";
import { acceptOffer, declineOffer, type LegacyRecord } from "@/lib/inputs/imports";
import { addToReport, type InputReport } from "@/lib/inputs/report";
import type { OutlineProblem, SizeSourcePick } from "@/lib/inputs/outline";
import { fixProblem } from "@/lib/inputs/problems";
import * as reduce from "@/lib/inputs/reducers";
import { NewerDocument, type WorkingDocument } from "@/lib/inputs/stored";
import type {
  ActiveItem,
  ControlSettings,
  FitPolicy,
  Frame,
  FrameRole,
  IpAdapterSettings,
  MaskObject,
  MaskStroke,
  Picture,
  PictureSource,
  ProcessorSpec,
  Size,
  Transform,
} from "@/lib/inputs/types";
import { DocumentConflict, NewerDatabase } from "@/inputs/db";
import { legacyMarks } from "@/inputs/legacySources";
import { clear, ignore, note, rehydrating } from "@/undo/marks";
import { FULL_ID, isQuotaError, reportFull } from "@/inputs/quota";
import {
  createInputsStorage,
  keepsFrames,
  loadOffer,
  overruleOtherTab,
  UnreadableBlobs,
  UnstorableDocument,
  type PersistedInputs,
} from "@/inputs/persistence";

/** A picture on its way into a frame; the store names it. */
export type NewPicture = Omit<PictureSource, "id" | "cid">;

/** A map on its way into a frame, with the cid its bytes are stored under when unchanged. */
export type NewMap = NewPicture & { cid?: string };

/** What a change to the inputs did, for the step it makes. */
export type EditKind =
  | "frame added"
  | "frame removed"
  | "frame moved"
  | "role"
  | "on"
  | "cleared"
  | "picture added"
  | "picture removed"
  | "picture moved"
  | "picture changed"
  | "placement"
  | "visibility"
  | "put back"
  | "merged"
  | "problem fixed"
  | "fit"
  | "link"
  | "control"
  | "ip adapter"
  | "processor"
  | "replaced"
  | "stroke"
  | "strokes cleared"
  | "bake"
  | "mask cleared"
  | "mask region removed"
  | "mask region changed"
  | "restored"
  | "appended"
  | "refit"
  | "size source";

/** Consequences of another change, which never name a step. */
const QUIET: ReadonlySet<EditKind> = new Set<EditKind>(["bake", "refit"]);

function noteEdit(kind: EditKind, frameId: string | null): void {
  note("images", frameId ? { kind, args: { frame: frameId } } : { kind }, {
    quiet: QUIET.has(kind),
  });
}

interface InputState extends WorkingDocument {
  /** The stored document is in, or the user chose to start without it.
   * Changes made before that wait for it. */
  ready: boolean;
  /** What the user has not been told yet about the stored inputs. */
  report: InputReport | null;
  /** Records of an older build that changed after they were imported. */
  offers: LegacyRecord[];
  /** Most input images the active model takes; null while unknown. A change
   * that would send more is refused (see onCapacityRefused). Not persisted. */
  imageLimit: number | null;

  /** Add an empty frame at `at`, by default after the last. Returns its id. */
  addFrame: (role: FrameRole, at?: number) => string;
  /** The last frame stays: there is always one to drop a picture on. */
  removeFrame: (frameId: string) => void;
  moveFrame: (from: number, to: number) => void;
  /** False when the model's image limit refused the switch. */
  switchRole: (frameId: string, role: FrameRole) => boolean;
  /** False when the model's image limit refused switching the frame on. */
  setEnabled: (frameId: string, enabled: boolean) => boolean;
  /** Remove everything the frame holds. */
  clearFrame: (frameId: string) => void;
  selectFrame: (frameId: string | null) => void;
  /** Undo writes one side of the inputs back: frames, size source and selection
   * in one write, past the image limit as a trash restore is. */
  applyUndo: (
    doc: { frames: Frame[]; sizeSource: SizeSourcePick | null },
    selection: reduce.Selection | null,
  ) => void;
  setActiveItem: (item: ActiveItem | null) => void;
  setImageLimit: (limit: number | null) => void;

  /** Returns the new picture's id, or null when the model's image limit refused it. */
  addPicture: (frameId: string, picture: NewPicture) => string | null;
  /** Replace the frame's pictures with one already at frame size. */
  setOnlyPicture: (frameId: string, picture: NewPicture) => string;
  removePicture: (frameId: string, pictureId: string) => void;
  movePicture: (frameId: string, from: number, to: number) => void;
  patchPicture: (frameId: string, pictureId: string, patch: reduce.PicturePatch) => void;
  setPictureTransform: (frameId: string, pictureId: string, transform: Transform) => void;
  /** Change part of a layer's placement: a placed picture's or a mask object's. */
  patchTransform: (frameId: string, itemId: string, patch: Partial<Transform>) => void;
  /** Remove a layer, picture or mask object. */
  removeItem: (frameId: string, itemId: string) => void;
  /** False when the model's image limit refused showing the picture. */
  setPictureVisible: (frameId: string, pictureId: string, visible: boolean) => boolean;
  /** False when the model's image limit refused showing them. */
  showHiddenBySwitch: (frameId: string) => boolean;

  /** A removed frame back at `at`, with the Control frames in `linkedFrom`
   * pointed at it again where they point at nothing. Never counted against
   * the image limit: a list over it is a problem the outline reports. */
  putBackFrame: (frame: Frame, at: number, linkedFrom: string[]) => void;
  /** A removed picture back at `at` in its frame. */
  insertPicture: (frameId: string, picture: Picture, at: number) => void;
  /** What a clear took out of a frame, back beside what it holds now. */
  mergeContent: (frameId: string, from: Frame) => void;
  /** A frame as it was, in place of the frame of the same id. */
  restoreFrame: (frame: Frame) => void;
  /** Apply the fix for a problem the outline reports. */
  fixProblem: (problem: OutlineProblem) => void;

  /** A composed frame's fit policy; null leaves placements to the hand. */
  setFit: (frameId: string, fit: FitPolicy | null) => void;
  /** Point a Control frame at the composed frame whose picture it sends, or at none. */
  setLink: (frameId: string, targetId: string | null) => void;
  patchControl: (frameId: string, patch: Partial<ControlSettings>) => void;
  patchIpAdapter: (frameId: string, patch: Partial<Omit<IpAdapterSettings, "masks">>) => void;
  /** Returns the new mask's id. */
  addIpMask: (frameId: string, picture: NewPicture) => string;
  removeIpMask: (frameId: string, pictureId: string) => void;
  /** The processor the frame's pictures go through, or none. */
  setProcessor: (frameId: string, processor: ProcessorSpec | null) => void;
  /** The map in a composed frame's composition's place; the processor goes. */
  replaceComposition: (frameId: string, map: NewMap) => void;
  /** Each picture's map in its place; the processor goes. */
  replacePictures: (frameId: string, maps: ReadonlyMap<string, NewMap>) => void;

  addStroke: (frameId: string, stroke: MaskStroke) => void;
  clearStrokes: (frameId: string) => void;
  applyBake: (frameId: string, consumed: number, objects: MaskObject[]) => void;
  clearMaskObjects: (frameId: string) => void;
  removeMaskObject: (frameId: string, objectId: string) => void;
  patchMaskObject: (frameId: string, objectId: string, patch: reduce.MaskObjectPatch) => void;

  /** The frames a result was made from take the list's place, as they were. */
  restoreFrames: (frames: Frame[]) => void;
  /** Prepared frames join the end of the list, or take the place of a list
   * of blank frames. False when the model's image limit refused them. */
  appendFrames: (frames: Frame[]) => boolean;
  setSizeSource: (pick: SizeSourcePick | null) => void;
  /** Fit every frame's content to a new frame size. */
  refitAll: (size: Size) => void;

  /** Bring in the content an older build saved after the first import. */
  acceptImport: (offer: LegacyRecord) => Promise<void>;
  declineImport: (offer: LegacyRecord) => void;
  /** The report has been shown. */
  dismissReport: () => void;
}

function working(s: WorkingDocument): WorkingDocument {
  return {
    frames: s.frames,
    selectedFrameId: s.selectedFrameId,
    activeItem: s.activeItem,
    sizeSource: s.sizeSource,
    imports: s.imports,
  };
}

function frameSize(): Size {
  const { width, height } = useGenerationStore.getState();
  return { width, height };
}

let refused: () => void = () => {};

/** Be told when the model's image limit refuses a change. Returns the unsubscribe. */
export function onCapacityRefused(handler: () => void): () => void {
  refused = handler;
  return () => {
    if (refused === handler) refused = () => {};
  };
}

const waiting: (() => void)[] = [];

/** Run now, or once the stored document is in. A change made on top of the
 * defaults would be replaced by the document when it arrives. */
function whenReady(run: () => void): void {
  if (useInputStore.getState().ready) run();
  else waiting.push(run);
}

function becomeReady(): void {
  useInputStore.setState({ ready: true });
  for (const run of waiting.splice(0)) run();
}

/** Resolves once the stored document is in. */
export function inputsReady(): Promise<void> {
  return new Promise((resolve) => whenReady(resolve));
}

const storage = createInputsStorage(
  (error) => {
    if (error instanceof UnreadableBlobs) {
      dropUnreadable(error.cids);
    } else if (error instanceof DocumentConflict) {
      reportStorageProblem({
        kind: "conflict",
        id: "inputs",
        what: "inputs",
        useStored: () => {
          rehydrating(useInputStore, true);
          void useInputStore.persist.rehydrate();
        },
        keepMine: () => void overruleOtherTab().then(() => storage.retry()),
      });
    } else if (isQuotaError(error)) {
      reportFull("Changes to the inputs", () => storage.retry());
    } else if (error instanceof UnstorableDocument) {
      reportStorageProblem({
        kind: "write",
        id: "inputs",
        what: "inputs",
        reason:
          "An input holds a value that cannot be stored. Undo your last change, or reload the page to go back to the saved inputs.",
      });
    } else {
      reportStorageProblem({ kind: "write", id: "inputs", what: "inputs" });
    }
  },
  () => {
    reportStorageProblem({ kind: "resolved", id: "inputs" });
    reportStorageProblem({ kind: "resolved", id: FULL_ID });
  },
);

/** Resolves once no write waits: true when the stored document holds the
 * inputs as they are now. */
export function settleInputs(): Promise<boolean> {
  return storage.settle();
}

/** Pictures whose bytes can no longer be read stay, marked unreadable; mask
 * objects go. Their Blobs would fail every later write. */
function dropUnreadable(cids: string[]): void {
  const dead = new Set(cids);
  ignore("unreadable bytes", () =>
    useInputStore.setState((s) => {
      const lost: InputReport["lost"] = { pictures: [], maskObjects: 0 };
      const frames = s.frames.map((frame): Frame => {
        const hit =
          frame.pictures.some((p) => p.file && dead.has(p.cid)) ||
          frame.mask.objects.some((m) => dead.has(m.cid));
        if (!hit) return frame;
        const objects = frame.mask.objects.filter((m) => !dead.has(m.cid));
        lost.maskObjects += frame.mask.objects.length - objects.length;
        return {
          ...frame,
          pictures: frame.pictures.map((p) => {
            if (!p.file || !dead.has(p.cid)) return p;
            lost.pictures.push({ frameId: frame.id, name: p.name });
            return { ...p, file: null };
          }),
          mask: { ...frame.mask, objects },
        };
      });
      return {
        frames,
        ...reduce.settleSelection(frames, s.frames, s),
        report: addToReport(s.report, { lost }),
      };
    }),
  );
  clear("images");
}

const seedFrame = reduce.newFrame(newId(), "initial");

export const useInputStore = create<InputState>()(
  persist(
    (set, get) => {
      /** Apply a change to the frame list and keep the selection valid. The
       * kind and frame name the step it makes. */
      const edit = (kind: EditKind, frameId: string | null, change: (frames: Frame[]) => Frame[]) =>
        whenReady(() =>
          set((s) => {
            const frames = change(s.frames);
            if (frames === s.frames) return s;
            noteEdit(kind, frameId);
            return { frames, ...reduce.settleSelection(frames, s.frames, s) };
          }),
        );
      const editFrame = (kind: EditKind, frameId: string, change: (frame: Frame) => Frame) =>
        edit(kind, frameId, (frames) => reduce.updateFrame(frames, frameId, change));
      /** Apply a change the model's image limit may refuse. Before the stored
       * document is in there is nothing to count against, so it goes through. */
      const guarded = (
        kind: EditKind,
        frameId: string | null,
        change: (frames: Frame[]) => Frame[],
      ): boolean => {
        const { ready, frames, imageLimit } = get();
        if (!ready) {
          edit(kind, frameId, change);
          return true;
        }
        const next = change(frames);
        if (next !== frames && exceedsLimit(frames, next, imageLimit)) {
          refused();
          return false;
        }
        edit(kind, frameId, () => next);
        return true;
      };
      const guardedFrame = (
        kind: EditKind,
        frameId: string,
        change: (frame: Frame) => Frame,
      ): boolean => guarded(kind, frameId, (frames) => reduce.updateFrame(frames, frameId, change));
      /** Make a layer the active one, when its frame is the selected one. */
      const activate = (frameId: string, id: string) =>
        whenReady(() =>
          set((s) => {
            const wanted = { selectedFrameId: s.selectedFrameId, activeItem: { frameId, id } };
            const { activeItem } = reduce.settleSelection(s.frames, s.frames, wanted);
            return activeItem ? { activeItem } : s;
          }),
        );
      const named = (picture: NewPicture, cid: string = newId()): PictureSource => ({
        ...picture,
        id: newId(),
        cid,
      });
      const answered = (s: InputState, offer: LegacyRecord) =>
        s.offers.filter((o) => o.id !== offer.id);

      return {
        frames: [seedFrame],
        selectedFrameId: seedFrame.id,
        activeItem: null,
        sizeSource: null,
        imports: {},
        ready: false,
        report: null,
        offers: [],
        imageLimit: null,

        addFrame: (role, at) => {
          const frame = reduce.newFrame(newId(), role);
          edit("frame added", frame.id, (frames) => reduce.insertFrame(frames, frame, at));
          return frame.id;
        },
        removeFrame: (frameId) =>
          edit("frame removed", frameId, (frames) =>
            frames.length > 1 ? reduce.removeFrame(frames, frameId) : frames,
          ),
        moveFrame: (from, to) =>
          edit("frame moved", get().frames[from]?.id ?? null, (frames) =>
            reduce.moveItem(frames, from, to),
          ),
        switchRole: (frameId, role) => {
          const before = get().frames.find((f) => f.id === frameId);
          if (!guardedFrame("role", frameId, (f) => reduce.switchRole(f, role, frameSize())))
            return false;
          // the picture a switch to Initial places is the layer to work on
          const placed = get()
            .frames.find((f) => f.id === frameId)
            ?.pictures.find((p, i) => p.transform && !before?.pictures[i]?.transform);
          if (placed) activate(frameId, placed.id);
          return true;
        },
        setEnabled: (frameId, enabled) =>
          guardedFrame("on", frameId, (f) => reduce.setEnabled(f, enabled)),
        clearFrame: (frameId) =>
          editFrame("cleared", frameId, (f) =>
            reduce.clearIpMasks(
              reduce.clearMaskObjects(reduce.clearStrokes(reduce.clearPictures(f))),
            ),
          ),
        selectFrame: (frameId) =>
          whenReady(() =>
            set((s) =>
              s.selectedFrameId === frameId
                ? s
                : reduce.settleSelection(s.frames, s.frames, {
                    selectedFrameId: frameId,
                    activeItem: s.activeItem,
                  }),
            ),
          ),
        // the active layer is always in the selected frame
        setActiveItem: (item) =>
          whenReady(() =>
            set(item ? { activeItem: item, selectedFrameId: item.frameId } : { activeItem: null }),
          ),
        setImageLimit: (limit) => set((s) => (s.imageLimit === limit ? s : { imageLimit: limit })),

        addPicture: (frameId, picture) => {
          const source = named(picture);
          if (
            !guardedFrame("picture added", frameId, (f) =>
              reduce.addPicture(f, source, frameSize()),
            )
          )
            return null;
          activate(frameId, source.id);
          return source.id;
        },
        setOnlyPicture: (frameId, picture) => {
          const source = named(picture);
          editFrame("picture added", frameId, (f) => reduce.setOnlyPicture(f, source));
          activate(frameId, source.id);
          return source.id;
        },
        removePicture: (frameId, pictureId) =>
          editFrame("picture removed", frameId, (f) => reduce.removePicture(f, pictureId)),
        movePicture: (frameId, from, to) =>
          editFrame("picture moved", frameId, (f) => reduce.movePicture(f, from, to)),
        patchPicture: (frameId, pictureId, patch) =>
          editFrame("picture changed", frameId, (f) => reduce.patchPicture(f, pictureId, patch)),
        setPictureTransform: (frameId, pictureId, transform) =>
          editFrame("placement", frameId, (f) =>
            reduce.setPictureTransform(f, pictureId, transform),
          ),
        patchTransform: (frameId, itemId, patch) =>
          editFrame("placement", frameId, (f) => reduce.patchTransform(f, itemId, patch)),
        removeItem: (frameId, itemId) =>
          editFrame("picture removed", frameId, (f) => reduce.removeItem(f, itemId)),
        setPictureVisible: (frameId, pictureId, visible) =>
          guardedFrame("visibility", frameId, (f) =>
            reduce.setPictureVisible(f, pictureId, visible, frameSize()),
          ),
        showHiddenBySwitch: (frameId) =>
          guardedFrame("visibility", frameId, (f) => reduce.showHiddenBySwitch(f, frameSize())),

        putBackFrame: (frame, at, linkedFrom) =>
          edit("put back", frame.id, (frames) => {
            if (frames.some((f) => f.id === frame.id)) return frames;
            return linkedFrom.reduce(
              (list, id) =>
                reduce.updateFrame(list, id, (f) => (f.link ? f : reduce.setLink(f, frame.id))),
              reduce.insertFrame(frames, frame, at),
            );
          }),
        insertPicture: (frameId, picture, at) =>
          editFrame("picture added", frameId, (f) => reduce.insertPicture(f, picture, at)),
        mergeContent: (frameId, from) =>
          editFrame("merged", frameId, (f) => reduce.mergeContent(f, from)),
        restoreFrame: (frame) => editFrame("put back", frame.id, () => frame),
        fixProblem: (problem) =>
          edit("problem fixed", null, (frames) => fixProblem(frames, problem)),

        setFit: (frameId, fit) =>
          editFrame("fit", frameId, (f) => reduce.setFit(f, fit, frameSize())),
        setLink: (frameId, targetId) =>
          editFrame("link", frameId, (f) => reduce.setLink(f, targetId)),
        patchControl: (frameId, patch) =>
          editFrame("control", frameId, (f) => reduce.patchControl(f, patch)),
        patchIpAdapter: (frameId, patch) =>
          editFrame("ip adapter", frameId, (f) => reduce.patchIpAdapter(f, patch)),
        addIpMask: (frameId, picture) => {
          const source = named(picture);
          editFrame("ip adapter", frameId, (f) => reduce.addIpMask(f, source));
          return source.id;
        },
        removeIpMask: (frameId, pictureId) =>
          editFrame("ip adapter", frameId, (f) => reduce.removeIpMask(f, pictureId)),
        setProcessor: (frameId, processor) =>
          editFrame("processor", frameId, (f) => reduce.setProcessor(f, processor)),
        replaceComposition: (frameId, map) =>
          editFrame("replaced", frameId, (f) => reduce.replaceComposition(f, named(map, map.cid))),
        replacePictures: (frameId, maps) =>
          editFrame("replaced", frameId, (f) =>
            reduce.replacePictures(
              f,
              new Map([...maps].map(([id, map]) => [id, named(map, map.cid)])),
            ),
          ),

        addStroke: (frameId, stroke) =>
          editFrame("stroke", frameId, (f) => reduce.addStroke(f, stroke)),
        clearStrokes: (frameId) => editFrame("strokes cleared", frameId, reduce.clearStrokes),
        applyBake: (frameId, consumed, objects) =>
          editFrame("bake", frameId, (f) => reduce.applyBake(f, consumed, objects)),
        clearMaskObjects: (frameId) => editFrame("mask cleared", frameId, reduce.clearMaskObjects),
        removeMaskObject: (frameId, objectId) =>
          editFrame("mask region removed", frameId, (f) => reduce.removeMaskObject(f, objectId)),
        patchMaskObject: (frameId, objectId, patch) =>
          editFrame("mask region changed", frameId, (f) =>
            reduce.patchMaskObject(f, objectId, patch),
          ),

        restoreFrames: (frames) =>
          whenReady(() =>
            set((s) => {
              noteEdit("restored", null);
              return {
                frames,
                ...reduce.settleSelection(frames, s.frames, {
                  selectedFrameId: frames[0]?.id ?? null,
                  activeItem: null,
                }),
                sizeSource: null,
              };
            }),
          ),
        appendFrames: (added) =>
          added.length === 0 ||
          guarded("appended", null, (frames) =>
            frames.every(reduce.isBlank) ? added : [...frames, ...added],
          ),
        setSizeSource: (pick) =>
          whenReady(() =>
            set((s) => {
              if (s.sizeSource === pick) return s;
              noteEdit("size source", pick?.frameId ?? null);
              return { sizeSource: pick };
            }),
          ),
        applyUndo: (doc, selection) =>
          set((s) => ({
            frames: doc.frames,
            sizeSource: doc.sizeSource,
            ...reduce.settleSelection(doc.frames, s.frames, selection ?? s),
          })),
        refitAll: (size) =>
          edit("refit", null, (frames) => {
            const next = frames.map((f) => refitFrame(f, size));
            return next.every((f, i) => f === frames[i]) ? frames : next;
          }),

        acceptImport: async (offer) => {
          const loaded = await loadOffer(offer, working(get()));
          ignore("import accepted", () =>
            set((s) => {
              // the record changed again or is gone: the next load offers what is there
              if (!loaded) return { offers: answered(s, offer) };
              const { doc, notes } = acceptOffer(
                working(s),
                offer,
                loaded,
                newId,
                keepsFrames(offer),
              );
              return {
                ...doc,
                offers: answered(s, offer),
                report: addToReport(s.report, { notes }),
              };
            }),
          );
          if (loaded) clear("images");
        },
        declineImport: (offer) =>
          set((s) => ({ ...declineOffer(working(s), offer), offers: answered(s, offer) })),
        dismissReport: () => set({ report: null }),
      };
    },
    {
      name: RECORD.working,
      storage,
      partialize: (s): PersistedInputs => working(s),
      merge: (persisted, current) => {
        const saved = persisted as PersistedInputs | undefined;
        if (!saved) return current;
        const found = {
          report: addToReport(null, saved.findings ?? {}),
          offers: saved.findings?.offers ?? [],
        };
        // no stored document, or one without a frame: keep the frame to drop on
        if (!saved.frames || saved.frames.length === 0) {
          return { ...current, imports: saved.imports ?? current.imports, ...found };
        }
        const selection = reduce.settleSelection(saved.frames, saved.frames, {
          selectedFrameId: saved.selectedFrameId ?? null,
          activeItem: saved.activeItem ?? null,
        });
        return {
          ...current,
          frames: saved.frames,
          ...selection,
          sizeSource: saved.sizeSource ?? null,
          imports: saved.imports ?? {},
          ...found,
        };
      },
      onRehydrateStorage: () => (_state, error) => {
        // a failed or superseded read never reaches zustand's finish listeners
        rehydrating(useInputStore, false);
        if (!error) {
          reportStorageProblem({ kind: "resolved", id: "inputs" });
          becomeReady();
          return;
        }
        reportStorageProblem({
          kind: "read",
          id: "inputs",
          what: "inputs",
          newer: error instanceof NewerDocument || error instanceof NewerDatabase,
          retry: () => {
            rehydrating(useInputStore, true);
            void useInputStore.persist.rehydrate();
          },
          startEmpty: () => {
            rehydrating(useInputStore, false);
            ignore("start empty", () => {
              storage.startEmpty();
              becomeReady();
            });
            clear("images");
            // or the next load would bring an older build's canvas back in
            void legacyMarks().then((imports) => useInputStore.setState({ imports }));
          },
        });
      },
    },
  ),
);
