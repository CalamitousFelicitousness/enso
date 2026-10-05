import { useCallback, useEffect, useRef, useState, memo } from "react";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import { addFilesToInputs } from "@/inputs/route";
import { composedPictures } from "@/lib/inputs/types";
import { mainViewport } from "@/canvas/viewportAdapter";
import { CanvasSurface, type SurfacePoint } from "@/canvas/CanvasSurface";
import { useControlStore } from "@/stores/controlStore";
import { useUiStore } from "@/stores/uiStore";
import { useShortcutScope } from "@/hooks/useShortcutScope";
import { useShortcut } from "@/hooks/useShortcut";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { payloadToFile } from "@/lib/sendTo";
import type { DragPayload } from "@/stores/dragStore";
import { CanvasStage } from "@/canvas/CanvasStage";
import { CanvasToolbar } from "@/canvas/CanvasToolbar";
import { ControlFramePanels } from "@/canvas/ControlFramePanel";
import { InputFramePanels } from "@/canvas/panels/InputFramePanels";
import { CanvasProgressOverlay } from "@/canvas/CanvasProgressOverlay";
import { useControlFrameLayout } from "@/canvas/useControlFrameLayout";
import { INPUTS_FULL_HINT } from "@/canvas/useInputsAtCapacity";
import { getOrderedFrames } from "@/canvas/frameList";
import { ModeToggle } from "./ModeToggle";
import { RotateCcw, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Where the file picker's result goes: a control unit, or an input frame
 * (null for the active one). */
type PickTarget = { unit: number } | { frameId: string | null };

function contains(p: SurfacePoint, x: number, y: number, w: number, h: number): boolean {
  return p.canvasX >= x && p.canvasX <= x + w && p.canvasY >= y && p.canvasY <= y + h;
}

/** The frame files go to: the given one, else the selected one, else the first. */
function targetFrame(frameId: string | null) {
  const state = useInputStore.getState();
  const id = frameId ?? state.selectedFrameId ?? state.frames[0]?.id;
  return state.frames.find((f) => f.id === id) ?? null;
}

export const CanvasView = memo(function CanvasView() {
  const visible = useKeepAliveVisible();
  useShortcutScope("canvas", visible);
  const setViewport = useCanvasStore((s) => s.setViewport);
  const selectedInitialHasImages = useInputStore((s) => {
    const f = s.frames.find((fr) => fr.id === s.selectedFrameId) ?? s.frames[0];
    return f?.role === "initial" && composedPictures(f).length > 0;
  });
  const hasAnyContent = useInputStore((s) =>
    s.frames.some((f) => f.pictures.length > 0 || f.mask.objects.length > 0),
  );
  const labelScale = useUiStore((s) => s.canvasLabelScale ?? 1);
  const canvasMode = useCanvasStore((s) => s.canvasMode);
  const focusedFrameId = useCanvasStore((s) => s.focusedFrameId);
  const setCanvasMode = useCanvasStore((s) => s.setCanvasMode);
  const setFocusedFrame = useCanvasStore((s) => s.setFocusedFrame);
  const bumpFocusFitTrigger = useCanvasStore((s) => s.bumpFocusFitTrigger);
  const modeLocked = useCanvasStore((s) => s.modeLocked);
  const setModeLocked = useCanvasStore((s) => s.setModeLocked);
  const setUnitImage = useControlStore((s) => s.setUnitImage);
  const setUnitParam = useControlStore((s) => s.setUnitParam);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickTarget, setPickTarget] = useState<PickTarget | null>(null);

  const layout = useControlFrameLayout();

  // Dropped, pasted and picked images go into an input frame: the one under
  // the drop or behind the clicked control, else the selected one.
  const addFiles = addFilesToInputs;

  // Which control frame a drop landed on, or -1 for the canvas itself
  const hitTestControlFrame = useCallback(
    (point: SurfacePoint): number =>
      layout.controlFrames.find((f) => contains(point, f.x, f.y, f.width, f.height))?.unitIndex ??
      -1,
    [layout.controlFrames],
  );

  // Which input frame a drop landed on, or null for anywhere else
  const hitTestInputFrame = useCallback(
    (point: SurfacePoint): string | null =>
      layout.inputFrames.find((f) =>
        f.kind === "initial"
          ? contains(point, f.x, f.y, f.displayW, f.displayH)
          : contains(point, f.x, f.y, f.motherW, f.motherH),
      )?.frameId ?? null,
    [layout.inputFrames],
  );

  const handleDropFiles = useCallback(
    (files: File[], point: SurfacePoint) => {
      const unit = hitTestControlFrame(point);
      // A control frame holds one image, so a multi-file drop there takes the
      // first and ignores the rest.
      if (unit >= 0) {
        const file = files[0];
        if (file) {
          setUnitImage(unit, file);
          setUnitParam(unit, "processedImage", null);
        }
        return;
      }
      void addFiles(files, hitTestInputFrame(point));
    },
    [hitTestControlFrame, hitTestInputFrame, addFiles, setUnitImage, setUnitParam],
  );

  const handleDropPayload = useCallback(
    (payload: DragPayload, point: SurfacePoint) => {
      const unit = hitTestControlFrame(point);
      const frameId = hitTestInputFrame(point);
      payloadToFile(payload)
        .then((f: File) => {
          if (unit >= 0) {
            setUnitImage(unit, f);
            setUnitParam(unit, "processedImage", null);
          } else {
            void addFiles([f], frameId);
          }
        })
        .catch(() => {});
    },
    [hitTestControlFrame, hitTestInputFrame, addFiles, setUnitImage, setUnitParam],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = "";
      setPickTarget(null);
      if (picked.length === 0) return;
      if (pickTarget && "unit" in pickTarget) {
        // Control frame pick - single file
        setUnitImage(pickTarget.unit, picked[0]);
        setUnitParam(pickTarget.unit, "processedImage", null);
        return;
      }
      void addFiles(picked, pickTarget?.frameId ?? null);
    },
    [pickTarget, addFiles, setUnitImage, setUnitParam],
  );

  // A pick that would give an input frame another slot is refused once the
  // frames hold as many images as the model takes. Adding a layer to a frame
  // that already sends an image adds no slot.
  const openPicker = useCallback(
    (target: PickTarget) => {
      if (!("unit" in target) && layout.inputsAtCapacity) {
        const frame = targetFrame(target.frameId);
        const addsSlot =
          !frame || frame.role === "reference" || composedPictures(frame).length === 0;
        if (addsSlot) {
          toast.info(INPUTS_FULL_HINT);
          return;
        }
      }
      setPickTarget(target);
      if (fileInputRef.current) {
        fileInputRef.current.multiple = !("unit" in target);
        fileInputRef.current.click();
      }
    },
    [layout.inputsAtCapacity],
  );

  const handleResetZoom = useCallback(() => {
    if (canvasMode === "focus") {
      bumpFocusFitTrigger();
    } else {
      setViewport({ x: 0, y: 0, scale: 1 });
      setTimeout(() => setViewport({ x: 0, y: 0, scale: 0.999 }), 0);
    }
  }, [canvasMode, bumpFocusFitTrigger, setViewport]);

  const handleToggleMode = useCallback(() => {
    setCanvasMode(canvasMode === "focus" ? "canvas" : "focus");
  }, [canvasMode, setCanvasMode]);

  // Shortcut: toggle focus/canvas mode
  useShortcut("canvas-toggle-mode", handleToggleMode);

  // Shortcut: previous frame (focus mode only)
  useShortcut(
    "canvas-focus-prev",
    useCallback(() => {
      if (canvasMode !== "focus") return;
      const frames = getOrderedFrames(layout);
      const currentId = focusedFrameId ?? "output";
      const idx = frames.findIndex((f) => f.id === currentId);
      if (idx > 0) setFocusedFrame(frames[idx - 1].id);
    }, [canvasMode, layout, focusedFrameId, setFocusedFrame]),
  );

  // Shortcut: next frame (focus mode only)
  useShortcut(
    "canvas-focus-next",
    useCallback(() => {
      if (canvasMode !== "focus") return;
      const frames = getOrderedFrames(layout);
      const currentId = focusedFrameId ?? "output";
      const idx = frames.findIndex((f) => f.id === currentId);
      if (idx >= 0 && idx < frames.length - 1) setFocusedFrame(frames[idx + 1].id);
    }, [canvasMode, layout, focusedFrameId, setFocusedFrame]),
  );

  // Re-center focused frame when panels resize the canvas area
  const rightPanelCollapsed = useUiStore((s) => s.rightPanelCollapsed);
  const leftPanelCollapsed = useUiStore((s) => s.leftPanelCollapsed);
  const viewCollapsed = useUiStore((s) => s.viewCollapsed);
  useEffect(() => {
    if (canvasMode === "focus") bumpFocusFitTrigger();
  }, [rightPanelCollapsed, leftPanelCollapsed, viewCollapsed, canvasMode, bumpFocusFitTrigger]);

  // Validate focused frame still exists when layout changes
  useEffect(() => {
    if (canvasMode !== "focus" || !focusedFrameId) return;
    const frames = getOrderedFrames(layout);
    if (!frames.some((f) => f.id === focusedFrameId)) {
      setFocusedFrame("output");
    }
  }, [canvasMode, focusedFrameId, layout, setFocusedFrame]);

  const handleClearFrame = useCallback((frameId: string) => {
    useInputStore.getState().clearFrame(frameId);
  }, []);

  const handleRemoveFrame = useCallback((frameId: string) => {
    useInputStore.getState().removeFrame(frameId);
  }, []);

  const handleClearAll = useCallback(() => {
    for (const frame of useInputStore.getState().frames) handleClearFrame(frame.id);
  }, [handleClearFrame]);

  const viewport = useCanvasStore((s) => s.viewport);
  // Reference frames take picked files as children, Initial frames as layers
  const handlePickInputFile = useCallback(
    (frameId: string) => openPicker({ frameId }),
    [openPicker],
  );

  // Add Input Frame from the column-bottom DOM button: a new Initial frame,
  // selected so the next pick or paste lands in it.
  const handleAddInputFrame = useCallback(() => {
    const inputs = useInputStore.getState();
    inputs.selectFrame(inputs.addFrame("initial"));
  }, []);

  const handlePasteFiles = useCallback(
    (files: File[]) => {
      void addFiles(files);
    },
    [addFiles],
  );

  // -1 picks into the selected input frame
  const handlePickImage = useCallback(
    (unitIndex: number) => openPicker(unitIndex >= 0 ? { unit: unitIndex } : { frameId: null }),
    [openPicker],
  );

  const handleClearImage = useCallback(
    (unitIndex: number) => {
      setUnitImage(unitIndex, null);
      setUnitParam(unitIndex, "processedImage", null);
    },
    [setUnitImage, setUnitParam],
  );

  return (
    <CanvasSurface
      viewport={mainViewport}
      onDropFiles={handleDropFiles}
      onDropPayload={handleDropPayload}
      onPasteFiles={handlePasteFiles}
      overlay={
        <>
          <ControlFramePanels
            layout={layout}
            onPickImage={handlePickImage}
            onClearImage={handleClearImage}
          />
          {/* Per-Input-frame DOM chrome: mode toggle, action buttons, drawer,
              +Add Input Frame placeholder, per-Reference-child X buttons. */}
          <InputFramePanels
            layout={layout}
            viewport={viewport}
            labelScale={labelScale}
            onPickImage={handlePickInputFile}
            onAddReferenceChild={handlePickInputFile}
            onClearFrame={handleClearFrame}
            onRemoveFrame={handleRemoveFrame}
            onAddInputFrame={handleAddInputFrame}
          />
        </>
      }
    >
      <CanvasStage
        layout={layout}
        onPickImage={handlePickImage}
        onPickInputFile={handlePickInputFile}
        onAddReferenceChild={handlePickInputFile}
      />

      {/* Top-right utility buttons */}
      <div className="absolute top-2 right-2 flex items-center gap-1.5">
        <ModeToggle
          mode={canvasMode}
          onModeChange={setCanvasMode}
          locked={modeLocked}
          onLockedChange={setModeLocked}
        />
        <Button
          variant="secondary"
          size="icon-xs"
          onClick={() => handlePickImage(-1)}
          title="Add an image layer to the canvas"
          className="bg-background/80 backdrop-blur-sm"
        >
          <Plus size={12} />
        </Button>
        <Button
          variant="secondary"
          size="icon-xs"
          onClick={handleResetZoom}
          title="Reset zoom"
          className="bg-background/80 backdrop-blur-sm"
        >
          <RotateCcw size={12} />
        </Button>
        {hasAnyContent && (
          <Button
            variant="secondary"
            size="icon-xs"
            onClick={handleClearAll}
            title="Clear all input frames"
            className="bg-background/80 backdrop-blur-sm"
          >
            <X size={12} />
          </Button>
        )}
      </div>

      {/* The mask toolbar shows while the selected frame is Initial and has
        at least one visible picture to paint over. */}
      {selectedInitialHasImages && <CanvasToolbar />}

      {/* Generation progress overlay - not affected by pan/zoom */}
      <CanvasProgressOverlay />

      {/* Single file input for both input frame and control frame picks */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileInput}
        className="hidden"
      />
    </CanvasSurface>
  );
});
