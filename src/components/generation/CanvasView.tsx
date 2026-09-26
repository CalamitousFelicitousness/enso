import { useCallback, useEffect, useRef, useState, memo } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { mainViewport } from "@/canvas/viewportAdapter";
import { CanvasSurface, type SurfacePoint } from "@/canvas/CanvasSurface";
import { useControlStore } from "@/stores/controlStore";
import { useUiStore } from "@/stores/uiStore";
import { useShortcutScope } from "@/hooks/useShortcutScope";
import { useShortcut } from "@/hooks/useShortcut";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { payloadToFile } from "@/lib/sendTo";
import type { DragPayload } from "@/stores/dragStore";
import { loadImageFile } from "@/lib/image";
import { CanvasStage } from "@/canvas/CanvasStage";
import { CanvasToolbar } from "@/canvas/CanvasToolbar";
import { ControlFramePanels } from "@/canvas/ControlFramePanel";
import { InputFramePanels } from "@/canvas/panels/InputFramePanels";
import { CanvasProgressOverlay } from "@/canvas/CanvasProgressOverlay";
import { useControlFrameLayout } from "@/canvas/useControlFrameLayout";
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

/** The frame files go to: the given one, else the active one, else the first. */
function targetFrame(frameId: string | null) {
  const state = useCanvasStore.getState();
  const id = frameId ?? state.activeInputFrameId ?? state.inputFrames[0]?.id;
  return state.inputFrames.find((f) => f.id === id) ?? null;
}

export const CanvasView = memo(function CanvasView() {
  const visible = useKeepAliveVisible();
  useShortcutScope("canvas", visible);
  const setViewport = useCanvasStore((s) => s.setViewport);
  // File-input handlers route to per-frame mutations on the focused
  // inputFrame.
  const focusedFrameInitialHasImages = useCanvasStore((s) => {
    const f = s.inputFrames.find((fr) => fr.id === s.activeInputFrameId) ?? s.inputFrames[0];
    return f?.mode === "initial" && f.layers.some((l) => l.type === "image" && l.visible);
  });
  const hasAnyContent = useCanvasStore((s) =>
    s.inputFrames.some(
      (f) =>
        (f.mode === "initial" && f.layers.length > 0) ||
        (f.mode === "reference" && f.references.length > 0),
    ),
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

  // Route dropped/pasted/picked images into an input frame: the one under the
  // drop or behind the clicked control, else the active one. Initial frames
  // receive image layers, Reference frames reference children. Every file is
  // decoded before any is added, so they land in the order given rather than
  // the order their decodes finish; that order is the order sent.
  const addFiles = useCallback(async (files: File[], frameId: string | null = null) => {
    const decoded = await Promise.allSettled(
      files.filter((f) => f.type.startsWith("image/")).map(loadImageFile),
    );
    const frame = targetFrame(frameId);
    if (!frame) return;
    const state = useCanvasStore.getState();
    if (frameId) state.setActiveInputFrame(frame.id);
    const add =
      frame.mode === "reference" ? state.appendReferenceToFrame : state.addImageLayerToFrame;
    for (const result of decoded) {
      if (result.status !== "fulfilled") continue;
      const { file, objectUrl, naturalWidth, naturalHeight } = result.value;
      add(frame.id, file, objectUrl, naturalWidth, naturalHeight);
    }
  }, []);

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

  const openPicker = useCallback((target: PickTarget) => {
    setPickTarget(target);
    if (fileInputRef.current) {
      fileInputRef.current.multiple = !("unit" in target);
      fileInputRef.current.click();
    }
  }, []);

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
    const state = useCanvasStore.getState();
    state.clearLayersInFrame(frameId);
    state.clearReferencesInFrame(frameId);
    state.clearMaskLinesInFrame(frameId);
    state.removeMaskLayersInFrame(frameId);
  }, []);

  const handleRemoveFrame = useCallback((frameId: string) => {
    useCanvasStore.getState().removeInputFrame(frameId);
  }, []);

  const handleClearAll = useCallback(() => {
    for (const frame of useCanvasStore.getState().inputFrames) {
      handleClearFrame(frame.id);
    }
  }, [handleClearFrame]);

  const viewport = useCanvasStore((s) => s.viewport);
  // Reference frames take picked files as children, Initial frames as layers
  const handlePickInputFile = useCallback(
    (frameId: string) => openPicker({ frameId }),
    [openPicker],
  );

  // +Add Input Frame from the column-bottom DOM button.
  // Creates a new Initial frame and focuses it so subsequent picks /
  // drops route there.
  const handleAddInputFrame = useCallback(() => {
    const state = useCanvasStore.getState();
    const newId = state.addInputFrame({ mode: "initial" });
    state.setActiveInputFrame(newId);
  }, []);

  const handlePasteFiles = useCallback(
    (files: File[]) => {
      void addFiles(files);
    },
    [addFiles],
  );

  // -1 picks into the active input frame
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

      {/* Mask painting toolbar gates on the focused frame: shows only when
        the focused frame is Initial and has at least one visible image.
        Mask painting will eventually be per-frame entirely; for
        now the toolbar still drives the global mask paint flow. */}
      {focusedFrameInitialHasImages && <CanvasToolbar />}

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
