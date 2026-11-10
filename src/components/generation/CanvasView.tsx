import { useCallback, useMemo, useRef, useState, useSyncExternalStore, memo } from "react";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import { addFilesToInputs, addServerPictures } from "@/inputs/route";
import { clearAllFrames, clearFrame, removeFrame } from "@/inputs/edits";
import { composedPictures, isComposed } from "@/lib/inputs/types";
import { frameBox, inBox } from "@/lib/inputs/layout";
import { mainCamera } from "@/canvas/navigation/cameras";
import { CanvasControls } from "@/canvas/navigation/CanvasControls";
import { ImagesMinimap } from "@/canvas/ImagesMinimap";
import { MINIMAP_NO_ROOM, MINIMAP_TOGGLE } from "@/canvas/navigation/text";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { useCameraCommands } from "@/canvas/navigation/useCameraCommands";
import { setViewMode, useFrameCursor } from "@/canvas/navigation/useFrameCursor";
import { unitScale } from "@/lib/viewport/camera";
import type { FitFrame } from "@/lib/viewport/insets";
import { positionLabel } from "@/lib/inputs/text";
import type { SurfaceTool } from "@/lib/viewport/gestures";
import { CanvasSurface, type SurfacePoint } from "@/canvas/CanvasSurface";
import { useUiStore } from "@/stores/uiStore";
import { useShortcutScope } from "@/hooks/useShortcutScope";
import { useShortcut } from "@/hooks/useShortcut";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { dropFailed, payloadToPicture } from "@/lib/sendTo";
import { ENTRY_MIME, type EntryPayload, type ImagePayload } from "@/lib/drag";
import { recallEntry } from "@/inputs/recall";
import { importAmong } from "@/inputs/recipes";
import { isPictureOrRecipe } from "@/lib/recipes/recipe";
import { PICTURES_AND_RECIPES } from "@/lib/recipes/text";
import { CanvasStage } from "@/canvas/CanvasStage";
import { CanvasToolbar } from "@/canvas/CanvasToolbar";
import { FramePanels } from "@/canvas/panels/FramePanels";
import { CanvasProgressOverlay } from "@/canvas/CanvasProgressOverlay";
import { useCanvasLayout } from "@/canvas/useCanvasLayout";
import { INPUTS_FULL_HINT } from "@/inputs/capacity";
import { getOrderedFrames } from "@/lib/inputs/frames";
import { useInputCommands } from "@/canvas/useInputCommands";
import { ModeToggle } from "./ModeToggle";
import { X, Plus, MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A left drag on empty canvas pans with the move tool; the mask tools paint. */
const imagesTool = (): SurfaceTool =>
  useCanvasStore.getState().activeTool === "move" ? "move" : "other";

/** The stored canvas view is in: the mode the first fit follows. */
function useCanvasHydrated(): boolean {
  return useSyncExternalStore(
    (cb) => useCanvasStore.persist.onFinishHydration(cb),
    () => useCanvasStore.persist.hasHydrated(),
  );
}

const initialFollow = () =>
  useCanvasStore.getState().canvasMode === "focus" ? ("frame" as const) : ("all" as const);

/** The frame files go to: the given one, else the selected one, else the first. */
function targetFrame(frameId: string | null) {
  const state = useInputStore.getState();
  const id = frameId ?? state.selectedFrameId ?? state.frames[0]?.id;
  return state.frames.find((f) => f.id === id) ?? null;
}

export const CanvasView = memo(function CanvasView() {
  const visible = useKeepAliveVisible();
  useShortcutScope("canvas", visible);
  const selectedComposedHasImages = useInputStore((s) => {
    const f = s.frames.find((fr) => fr.id === s.selectedFrameId) ?? s.frames[0];
    return f !== undefined && isComposed(f.role) && composedPictures(f).length > 0;
  });
  const hasAnyContent = useInputStore((s) =>
    s.frames.some((f) => f.pictures.length > 0 || f.mask.objects.length > 0),
  );
  const labelScale = useUiStore((s) => s.canvasLabelScale ?? 1);
  const canvasMode = useCanvasStore((s) => s.canvasMode);
  const modeFlips = useCanvasStore((s) => s.modeFlips);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Where the picker's files go: a frame, or null for the selected one
  const [pickTarget, setPickTarget] = useState<string | null>(null);

  const layout = useCanvasLayout();
  const current = useFrameCursor(layout, visible);
  const fitFrames = useMemo<FitFrame[]>(
    () => getOrderedFrames(layout).map(({ id, ...box }) => ({ id, box })),
    [layout],
  );
  const inputsReady = useInputStore((s) => s.ready);
  const hydrated = useCanvasHydrated();
  useCameraCommands({
    camera: mainCamera,
    frames: fitFrames,
    unit: unitScale(layout.displayScale),
    current,
    ready: inputsReady && hydrated,
    initialFollow,
    visible,
    name: "canvas",
    frameCommands: true,
  });
  const minimapOn = useUiStore((s) => s.canvasMinimap);
  const minimapRoom = useCanvasStore((s) => s.minimapRoom);
  const setMinimap = useCallback((on: boolean) => {
    useUiStore.getState().setCanvasMinimap(on);
    if (on && !useCanvasStore.getState().minimapRoom) toast.info(MINIMAP_NO_ROOM);
  }, []);
  useRegisterCommand(
    {
      id: "canvas:toggle-minimap",
      label: MINIMAP_TOGGLE,
      group: "Canvas",
      keywords: ["minimap", "overview", "map", "navigator"],
      icon: MapIcon,
      run: () => setMinimap(!useUiStore.getState().canvasMinimap),
    },
    visible,
  );
  const currentName = useMemo(() => {
    if (current === "output") return "Output";
    const index = layout.frames.findIndex((f) => `input:${f.frameId}` === current);
    return index < 0 ? "Output" : positionLabel(index + 1);
  }, [current, layout.frames]);

  // Which frame a drop landed on, or null for anywhere else
  const hitTestFrame = useCallback(
    (point: SurfacePoint): string | null =>
      layout.frames.find((f) => inBox(frameBox(f), point.canvasX, point.canvasY))?.frameId ?? null,
    [layout.frames],
  );

  const handleDropFiles = useCallback(
    (files: File[], point: SurfacePoint) => {
      const pictures = importAmong(files);
      if (pictures.length > 0) void addFilesToInputs(pictures, hitTestFrame(point));
    },
    [hitTestFrame],
  );

  const handleDropImage = useCallback(
    (payload: ImagePayload, point: SurfacePoint) => {
      const frameId = hitTestFrame(point);
      Promise.resolve()
        .then(() => addServerPictures([payloadToPicture(payload)], frameId))
        .catch(dropFailed);
    },
    [hitTestFrame],
  );

  // A dragged picture lands in the frame under it, else the selected one,
  // else the first; an entry joins the inputs wherever it is dropped
  const handleDragPoint = useCallback(
    (point: SurfacePoint | null, e?: React.DragEvent) => {
      const { setDropFrame } = useCanvasStore.getState();
      if (!point || e?.dataTransfer.types.includes(ENTRY_MIME)) {
        setDropFrame(null);
        return;
      }
      const inputs = useInputStore.getState();
      setDropFrame(hitTestFrame(point) ?? inputs.selectedFrameId ?? inputs.frames[0]?.id ?? null);
    },
    [hitTestFrame],
  );

  // A library entry joins the inputs wherever it is dropped
  const handleDropEntry = useCallback((payload: EntryPayload) => {
    void recallEntry(payload.entryId, "add");
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = "";
      setPickTarget(null);
      if (picked.length === 0) return;
      void addFilesToInputs(picked, pickTarget);
    },
    [pickTarget],
  );

  // A pick that would give an input frame another slot is refused once the
  // frames hold as many images as the model takes. Adding a layer to a frame
  // that already sends an image adds no slot; Control and IP-Adapter frames
  // never count.
  const openPicker = useCallback(
    (frameId: string | null) => {
      if (layout.inputsAtCapacity) {
        const frame = targetFrame(frameId);
        const countsAsInput = !frame || frame.role === "initial" || frame.role === "reference";
        const addsSlot =
          countsAsInput &&
          (!frame || frame.role === "reference" || composedPictures(frame).length === 0);
        if (addsSlot) {
          toast.info(INPUTS_FULL_HINT);
          return;
        }
      }
      setPickTarget(frameId);
      fileInputRef.current?.click();
    },
    [layout.inputsAtCapacity],
  );

  // Escape leaves Edit mode on a processed frame and goes back to the move tool
  useShortcut(
    "canvas-deselect",
    () => {
      const canvas = useCanvasStore.getState();
      canvas.setEditingFrame(null);
      canvas.setActiveTool("move");
    },
    visible,
  );
  useInputCommands(visible);

  const handleClearFrame = useCallback((frameId: string) => {
    clearFrame(frameId);
  }, []);

  const handleRemoveFrame = useCallback((frameId: string) => {
    removeFrame(frameId);
  }, []);

  const handleClearAll = useCallback(() => {
    clearAllFrames();
  }, []);

  // Set frames take picked files as cells, composed frames as layers
  const handlePickForFrame = useCallback((frameId: string) => openPicker(frameId), [openPicker]);

  const handlePasteFiles = useCallback((files: File[]) => {
    const pictures = importAmong(files);
    if (pictures.length > 0) void addFilesToInputs(pictures);
  }, []);

  return (
    <CanvasSurface
      camera={mainCamera}
      tool={imagesTool}
      onDropFiles={handleDropFiles}
      onDragPoint={handleDragPoint}
      onDropImage={handleDropImage}
      onDropEntry={handleDropEntry}
      onPasteFiles={handlePasteFiles}
      acceptFile={isPictureOrRecipe}
      acceptKinds={PICTURES_AND_RECIPES}
      overlay={
        <FramePanels
          layout={layout}
          labelScale={labelScale}
          onPickImage={handlePickForFrame}
          onAddCell={handlePickForFrame}
          onClearFrame={handleClearFrame}
          onRemoveFrame={handleRemoveFrame}
        />
      }
      controls={
        <CanvasControls
          camera={mainCamera}
          mode={<ModeToggle mode={canvasMode} onModeChange={setViewMode} flips={modeFlips} />}
          frameName={currentName}
          minimap={{ on: minimapOn, room: minimapRoom, onChange: setMinimap }}
          tour="canvas-controls"
        >
          <Button
            variant="secondary"
            size="icon-xs"
            onClick={() => openPicker(null)}
            title="Add an image to the selected frame"
            className="bg-background/80 backdrop-blur-sm"
          >
            <Plus size={12} />
          </Button>
          <Button
            variant="secondary"
            size="icon-xs"
            onClick={handleClearAll}
            disabled={!hasAnyContent}
            title={hasAnyContent ? "Clear all frames" : "Nothing to clear"}
            className="bg-background/80 backdrop-blur-sm"
          >
            <X size={12} />
          </Button>
        </CanvasControls>
      }
      minimap={<ImagesMinimap layout={layout} current={current} />}
    >
      <CanvasStage layout={layout} onPickFile={handlePickForFrame} onAddCell={handlePickForFrame} />

      {/* The mask toolbar shows while the selected frame composes a picture
        and has at least one visible layer to paint over. */}
      {selectedComposedHasImages && <CanvasToolbar />}

      {/* Generation progress overlay - not affected by pan/zoom */}
      <CanvasProgressOverlay />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileInput}
        className="hidden"
      />
    </CanvasSurface>
  );
});
