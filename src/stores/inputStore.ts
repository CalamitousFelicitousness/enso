import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useGenerationStore } from "@/stores/generationStore";
import { reportStorageProblem } from "@/lib/storageHealth";
import { refitFrame } from "@/lib/inputs/geometry";
import { acceptOffer, declineOffer, type LegacyRecord } from "@/lib/inputs/imports";
import { addToReport, type InputReport } from "@/lib/inputs/report";
import type { SizeSourcePick } from "@/lib/inputs/outline";
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
  PictureSource,
  ProcessedPreview,
  Size,
  Transform,
} from "@/lib/inputs/types";
import { DocumentConflict, NewerDatabase } from "@/inputs/db";
import {
  createInputsStorage,
  legacyMarks,
  loadOffer,
  overruleOtherTab,
  UnreadableBlobs,
  UnstorableDocument,
  type PersistedInputs,
} from "@/inputs/persistence";

/** A picture on its way into a frame; the store names it. */
export type NewPicture = Omit<PictureSource, "id" | "cid">;

interface InputState extends WorkingDocument {
  /** The stored document is in, or the user chose to start without it.
   * Changes made before that wait for it. */
  ready: boolean;
  /** What the user has not been told yet about the stored inputs. */
  report: InputReport | null;
  /** Records of an older build that changed after they were imported. */
  offers: LegacyRecord[];

  /** Add an empty frame at `at`, by default after the last. Returns its id. */
  addFrame: (role: FrameRole, at?: number) => string;
  /** The last frame stays: there is always one to drop a picture on. */
  removeFrame: (frameId: string) => void;
  moveFrame: (from: number, to: number) => void;
  switchRole: (frameId: string, role: FrameRole) => void;
  setEnabled: (frameId: string, enabled: boolean) => void;
  /** Remove everything the frame holds. */
  clearFrame: (frameId: string) => void;
  selectFrame: (frameId: string | null) => void;
  setActiveItem: (item: ActiveItem | null) => void;

  /** Returns the new picture's id. */
  addPicture: (frameId: string, picture: NewPicture) => string;
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
  setPictureVisible: (frameId: string, pictureId: string, visible: boolean) => void;
  showHiddenBySwitch: (frameId: string) => void;

  /** A composed frame's fit policy; null leaves placements to the hand. */
  setFit: (frameId: string, fit: FitPolicy | null) => void;
  /** Point a Control frame at the composed frame whose picture it sends, or at none. */
  setLink: (frameId: string, targetId: string | null) => void;
  patchControl: (frameId: string, patch: Partial<ControlSettings>) => void;
  patchIpAdapter: (frameId: string, patch: Partial<Omit<IpAdapterSettings, "masks">>) => void;
  /** Returns the new mask's id. */
  addIpMask: (frameId: string, picture: NewPicture) => string;
  removeIpMask: (frameId: string, pictureId: string) => void;
  setProcessed: (frameId: string, processed: ProcessedPreview | null) => void;
  /** Drop every Control frame's processed map, as a job's own processing replaces them. */
  clearProcessed: () => void;

  addStroke: (frameId: string, stroke: MaskStroke) => void;
  clearStrokes: (frameId: string) => void;
  applyBake: (frameId: string, consumed: number, objects: MaskObject[]) => void;
  clearMaskObjects: (frameId: string) => void;
  removeMaskObject: (frameId: string, objectId: string) => void;
  patchMaskObject: (frameId: string, objectId: string, patch: reduce.MaskObjectPatch) => void;

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
        useStored: () => void useInputStore.persist.rehydrate(),
        keepMine: () => void overruleOtherTab().then(() => storage.retry()),
      });
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
  () => reportStorageProblem({ kind: "resolved", id: "inputs" }),
);

/** Pictures whose bytes can no longer be read stay, marked unreadable; mask
 * objects go. Their Blobs would fail every later write. */
function dropUnreadable(cids: string[]): void {
  const dead = new Set(cids);
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
  });
}

const seedFrame = reduce.newFrame(crypto.randomUUID(), "initial");

export const useInputStore = create<InputState>()(
  persist(
    (set, get) => {
      /** Apply a change to the frame list and keep the selection valid. */
      const edit = (change: (frames: Frame[]) => Frame[]) =>
        whenReady(() =>
          set((s) => {
            const frames = change(s.frames);
            return frames === s.frames
              ? s
              : { frames, ...reduce.settleSelection(frames, s.frames, s) };
          }),
        );
      const editFrame = (frameId: string, change: (frame: Frame) => Frame) =>
        edit((frames) => reduce.updateFrame(frames, frameId, change));
      /** Make a layer the active one, when its frame is the selected one. */
      const activate = (frameId: string, id: string) =>
        whenReady(() =>
          set((s) => {
            const wanted = { selectedFrameId: s.selectedFrameId, activeItem: { frameId, id } };
            const { activeItem } = reduce.settleSelection(s.frames, s.frames, wanted);
            return activeItem ? { activeItem } : s;
          }),
        );
      const named = (picture: NewPicture): PictureSource => ({
        ...picture,
        id: crypto.randomUUID(),
        cid: crypto.randomUUID(),
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

        addFrame: (role, at) => {
          const frame = reduce.newFrame(crypto.randomUUID(), role);
          edit((frames) => reduce.insertFrame(frames, frame, at));
          return frame.id;
        },
        removeFrame: (frameId) =>
          edit((frames) => (frames.length > 1 ? reduce.removeFrame(frames, frameId) : frames)),
        moveFrame: (from, to) => edit((frames) => reduce.moveItem(frames, from, to)),
        switchRole: (frameId, role) => {
          const before = get().frames.find((f) => f.id === frameId);
          editFrame(frameId, (f) => reduce.switchRole(f, role, frameSize()));
          // the picture a switch to Initial places is the layer to work on
          const placed = get()
            .frames.find((f) => f.id === frameId)
            ?.pictures.find((p, i) => p.transform && !before?.pictures[i]?.transform);
          if (placed) activate(frameId, placed.id);
        },
        setEnabled: (frameId, enabled) => editFrame(frameId, (f) => reduce.setEnabled(f, enabled)),
        clearFrame: (frameId) =>
          editFrame(frameId, (f) =>
            reduce.setProcessed(
              reduce.clearIpMasks(
                reduce.clearMaskObjects(reduce.clearStrokes(reduce.clearPictures(f))),
              ),
              null,
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

        addPicture: (frameId, picture) => {
          const source = named(picture);
          editFrame(frameId, (f) => reduce.addPicture(f, source, frameSize()));
          activate(frameId, source.id);
          return source.id;
        },
        setOnlyPicture: (frameId, picture) => {
          const source = named(picture);
          editFrame(frameId, (f) => reduce.setOnlyPicture(f, source));
          activate(frameId, source.id);
          return source.id;
        },
        removePicture: (frameId, pictureId) =>
          editFrame(frameId, (f) => reduce.removePicture(f, pictureId)),
        movePicture: (frameId, from, to) =>
          editFrame(frameId, (f) => reduce.movePicture(f, from, to)),
        patchPicture: (frameId, pictureId, patch) =>
          editFrame(frameId, (f) => reduce.patchPicture(f, pictureId, patch)),
        setPictureTransform: (frameId, pictureId, transform) =>
          editFrame(frameId, (f) => reduce.setPictureTransform(f, pictureId, transform)),
        patchTransform: (frameId, itemId, patch) =>
          editFrame(frameId, (f) => reduce.patchTransform(f, itemId, patch)),
        removeItem: (frameId, itemId) => editFrame(frameId, (f) => reduce.removeItem(f, itemId)),
        setPictureVisible: (frameId, pictureId, visible) =>
          editFrame(frameId, (f) => reduce.setPictureVisible(f, pictureId, visible, frameSize())),
        showHiddenBySwitch: (frameId) =>
          editFrame(frameId, (f) => reduce.showHiddenBySwitch(f, frameSize())),

        setFit: (frameId, fit) => editFrame(frameId, (f) => reduce.setFit(f, fit, frameSize())),
        setLink: (frameId, targetId) => editFrame(frameId, (f) => reduce.setLink(f, targetId)),
        patchControl: (frameId, patch) => editFrame(frameId, (f) => reduce.patchControl(f, patch)),
        patchIpAdapter: (frameId, patch) =>
          editFrame(frameId, (f) => reduce.patchIpAdapter(f, patch)),
        addIpMask: (frameId, picture) => {
          const source = named(picture);
          editFrame(frameId, (f) => reduce.addIpMask(f, source));
          return source.id;
        },
        removeIpMask: (frameId, pictureId) =>
          editFrame(frameId, (f) => reduce.removeIpMask(f, pictureId)),
        setProcessed: (frameId, processed) =>
          editFrame(frameId, (f) => reduce.setProcessed(f, processed)),
        clearProcessed: () =>
          edit((frames) => {
            const next = frames.map((f) => reduce.setProcessed(f, null));
            return next.every((f, i) => f === frames[i]) ? frames : next;
          }),

        addStroke: (frameId, stroke) => editFrame(frameId, (f) => reduce.addStroke(f, stroke)),
        clearStrokes: (frameId) => editFrame(frameId, reduce.clearStrokes),
        applyBake: (frameId, consumed, objects) =>
          editFrame(frameId, (f) => reduce.applyBake(f, consumed, objects)),
        clearMaskObjects: (frameId) => editFrame(frameId, reduce.clearMaskObjects),
        removeMaskObject: (frameId, objectId) =>
          editFrame(frameId, (f) => reduce.removeMaskObject(f, objectId)),
        patchMaskObject: (frameId, objectId, patch) =>
          editFrame(frameId, (f) => reduce.patchMaskObject(f, objectId, patch)),

        setSizeSource: (pick) => whenReady(() => set({ sizeSource: pick })),
        refitAll: (size) =>
          edit((frames) => {
            const next = frames.map((f) => refitFrame(f, size));
            return next.every((f, i) => f === frames[i]) ? frames : next;
          }),

        acceptImport: async (offer) => {
          const loaded = await loadOffer(offer);
          set((s) => {
            // the record changed again or is gone: the next load offers what is there
            if (!loaded) return { offers: answered(s, offer) };
            const { doc, notes } = acceptOffer(working(s), offer, loaded, () =>
              crypto.randomUUID(),
            );
            return { ...doc, offers: answered(s, offer), report: addToReport(s.report, { notes }) };
          });
        },
        declineImport: (offer) =>
          set((s) => ({ ...declineOffer(working(s), offer), offers: answered(s, offer) })),
        dismissReport: () => set({ report: null }),
      };
    },
    {
      name: "working",
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
          retry: () => void useInputStore.persist.rehydrate(),
          startEmpty: () => {
            storage.startEmpty();
            becomeReady();
            // or the next load would bring an older build's canvas back in
            void legacyMarks().then((imports) => useInputStore.setState({ imports }));
          },
        });
      },
    },
  ),
);
