import { useCallback, useEffect, useRef, useState, memo } from "react";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import { addFilesToInputs } from "@/inputs/route";
import { clearAllFrames, clearFrame, removeFrame } from "@/inputs/edits";
import { composedPictures, isComposed } from "@/lib/inputs/types";
import { frameBox, inBox } from "@/lib/inputs/layout";
import { mainViewport } from "@/canvas/viewportAdapter";
import { CanvasSurface, type SurfacePoint } from "@/canvas/CanvasSurface";
import { useUiStore } from "@/stores/uiStore";
import { useShortcutScope } from "@/hooks/useShortcutScope";
import { useShortcut } from "@/hooks/useShortcut";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { payloadToFile } from "@/lib/sendTo";
import type { DragPayload } from "@/stores/dragStore";
import { CanvasStage } from "@/canvas/CanvasStage";
import { CanvasToolbar } from "@/canvas/CanvasToolbar";
import { FramePanels } from "@/canvas/panels/FramePanels";
import { CanvasProgressOverlay } from "@/canvas/CanvasProgressOverlay";
import { useCanvasLayout } from "@/canvas/useCanvasLayout";
import { INPUTS_FULL_HINT } from "@/inputs/capacity";
import { getOrderedFrames } from "@/canvas/frameList";
import { ModeToggle } from "./ModeToggle";
import { RotateCcw, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  const selectedComposedHasImages = useInputStore((s) => {
    const f = s.frames.find((fr) => fr.id === s.selectedFrameId) ?? s.frames[0];
    return f !== undefined && isComposed(f.role) && composedPictures(f).length > 0;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Where the picker's files go: a frame, or null for the selected one
  const [pickTarget, setPickTarget] = useState<string | null>(null);

  const layout = useCanvasLayout();

  // Which frame a drop landed on, or null for anywhere else
  const hitTestFrame = useCallback(
    (point: SurfacePoint): string | null =>
      layout.frames.find((f) => inBox(frameBox(f), point.canvasX, point.canvasY))?.frameId ?? null,
    [layout.frames],
  );

  const handleDropFiles = useCallback(
    (files: File[], point: SurfacePoint) => {
      void addFilesToInputs(files, hitTestFrame(point));
    },
    [hitTestFrame],
  );

  const handleDropPayload = useCallback(
    (payload: DragPayload, point: SurfacePoint) => {
      const frameId = hitTestFrame(point);
      payloadToFile(payload)
        .then((f: File) => {
          void addFilesToInputs([f], frameId);
        })
        .catch(() => {});
    },
    [hitTestFrame],
  );

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
    clearFrame(frameId);
  }, []);

  const handleRemoveFrame = useCallback((frameId: string) => {
    removeFrame(frameId);
  }, []);

  const handleClearAll = useCallback(() => {
    clearAllFrames();
  }, []);

  const viewport = useCanvasStore((s) => s.viewport);
  // Set frames take picked files as cells, composed frames as layers
  const handlePickForFrame = useCallback((frameId: string) => openPicker(frameId), [openPicker]);

  // A new frame is selected so the next pick or paste lands in it
  const handleAddInputFrame = useCallback(() => {
    const inputs = useInputStore.getState();
    inputs.selectFrame(inputs.addFrame("initial"));
  }, []);
  const handleAddControlFrame = useCallback(() => {
    const inputs = useInputStore.getState();
    inputs.selectFrame(inputs.addFrame("control"));
  }, []);

  const handlePasteFiles = useCallback((files: File[]) => {
    void addFilesToInputs(files);
  }, []);

  return (
    <CanvasSurface
      viewport={mainViewport}
      onDropFiles={handleDropFiles}
      onDropPayload={handleDropPayload}
      onPasteFiles={handlePasteFiles}
      overlay={
        <FramePanels
          layout={layout}
          viewport={viewport}
          labelScale={labelScale}
          onPickImage={handlePickForFrame}
          onAddCell={handlePickForFrame}
          onClearFrame={handleClearFrame}
          onRemoveFrame={handleRemoveFrame}
          onAddInputFrame={handleAddInputFrame}
          onAddControlFrame={handleAddControlFrame}
        />
      }
    >
      <CanvasStage layout={layout} onPickFile={handlePickForFrame} onAddCell={handlePickForFrame} />

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
          onClick={() => openPicker(null)}
          title="Add an image to the selected frame"
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
            title="Clear all frames"
            className="bg-background/80 backdrop-blur-sm"
          >
            <X size={12} />
          </Button>
        )}
      </div>

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
