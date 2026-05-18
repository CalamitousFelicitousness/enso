import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { mainViewportBus } from "@/canvas/viewportBus";
import { useControlStore } from "@/stores/controlStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useUiStore } from "@/stores/uiStore";
import { useShortcutScope } from "@/hooks/useShortcutScope";
import { useShortcut } from "@/hooks/useShortcut";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { useDropTarget } from "@/hooks/useDropTarget";
import { payloadToFile } from "@/lib/sendTo";
import type { DragPayload } from "@/stores/dragStore";
import { fileToBase64 } from "@/lib/image";
import { CanvasStage } from "@/canvas/CanvasStage";
import { CanvasToolbar } from "@/canvas/CanvasToolbar";
import { ControlFramePanels } from "@/canvas/ControlFramePanel";
import { InputFramePanels } from "@/canvas/panels/InputFramePanels";
import { CanvasProgressOverlay } from "./CanvasProgressOverlay";
import { useControlFrameLayout } from "@/canvas/useControlFrameLayout";
import { getOrderedFrames } from "@/canvas/frameList";
import { ModeToggle } from "./ModeToggle";
import { RotateCcw, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export const CanvasView = memo(function CanvasView() {
  const visible = useKeepAliveVisible();
  useShortcutScope("canvas", visible);
  const setViewport = useCanvasStore((s) => s.setViewport);
  // Phase 7: file-input handlers route to per-frame mutations on the
  // focused inputFrame. Legacy state.layers is no longer the source of
  // truth post-chrome-swap; Phase 9 deletes the legacy mutations.
  const inputFrames = useCanvasStore((s) => s.inputFrames);
  const activeInputFrameId = useCanvasStore((s) => s.activeInputFrameId);
  const focusedFrame = useMemo(
    () => inputFrames.find((f) => f.id === activeInputFrameId) ?? inputFrames[0] ?? null,
    [inputFrames, activeInputFrameId],
  );
  const focusedFrameInitialHasImages =
    focusedFrame?.mode === "initial" &&
    focusedFrame.layers.some((l) => l.type === "image" && l.visible);
  const hasAnyContent = inputFrames.some(
    (f) =>
      (f.mode === "initial" && f.layers.length > 0) ||
      (f.mode === "reference" && f.references.length > 0),
  );
  const labelScale = useUiStore((s) => s.canvasLabelScale ?? 1);
  const clearMask = useImg2ImgStore((s) => s.clearMask);
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
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [pendingUnitIndex, setPendingUnitIndex] = useState<number | null>(null);

  const layout = useControlFrameLayout();

  // Route a single dropped/pasted/picked image into the focused inputFrame
  // (falling back to inputFrames[0] when nothing's explicitly focused).
  // Initial-mode targets receive a new ImageLayer; Reference-mode targets
  // get a new reference child. Empty-frames-list short-circuits silently;
  // Phase 10 wires the drag-onto-empty-canvas path that creates a new
  // frame on demand.
  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const base64 = await fileToBase64(file);
    const objectUrl = URL.createObjectURL(file);
    const img = new window.Image();
    img.src = objectUrl;
    await new Promise<void>((r) => {
      img.onload = () => r();
    });
    const state = useCanvasStore.getState();
    const target = state.activeInputFrameId ?? state.inputFrames[0]?.id;
    if (!target) return;
    const frame = state.inputFrames.find((f) => f.id === target);
    if (frame?.mode === "reference") {
      state.appendReferenceToFrame(
        target,
        file,
        base64,
        objectUrl,
        img.naturalWidth,
        img.naturalHeight,
      );
    } else {
      state.addImageLayerToFrame(
        target,
        file,
        base64,
        objectUrl,
        img.naturalWidth,
        img.naturalHeight,
      );
    }
  }, []);

  // Hit-test control frames, returning the unitIndex or -1 for canvas
  const hitTestControlFrame = useCallback(
    (e: React.DragEvent): number => {
      const container = containerRef.current;
      if (!container) return -1;
      const rect = container.getBoundingClientRect();
      const vp = useCanvasStore.getState().viewport;
      const canvasX = (e.clientX - rect.left - vp.x) / vp.scale;
      const canvasY = (e.clientY - rect.top - vp.y) / vp.scale;
      for (const frame of layout.controlFrames) {
        if (
          canvasX >= frame.x &&
          canvasX <= frame.x + frame.width &&
          canvasY >= frame.y &&
          canvasY <= frame.y + frame.height
        ) {
          return frame.unitIndex;
        }
      }
      return -1;
    },
    [layout.controlFrames],
  );

  const handleCanvasFileDrop = useCallback(
    (file: File, e: React.DragEvent) => {
      const unit = hitTestControlFrame(e);
      if (unit >= 0) {
        setUnitImage(unit, file);
        setUnitParam(unit, "processedImage", null);
      } else {
        void handleFile(file);
      }
    },
    [hitTestControlFrame, handleFile, setUnitImage, setUnitParam],
  );

  const { isOver, ...dropHandlers } = useDropTarget({
    onDropPayload: useCallback(
      (payload: DragPayload, e: React.DragEvent) => {
        // Hit-test synchronously before the event is recycled by React
        const unit = hitTestControlFrame(e);
        payloadToFile(payload)
          .then((f: File) => {
            if (unit >= 0) {
              setUnitImage(unit, f);
              setUnitParam(unit, "processedImage", null);
            } else {
              void handleFile(f);
            }
          })
          .catch(() => {});
      },
      [hitTestControlFrame, handleFile, setUnitImage, setUnitParam],
    ),
    onFileDrop: handleCanvasFileDrop,
  });

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) {
        e.target.value = "";
        setPendingUnitIndex(null);
        return;
      }
      if (pendingUnitIndex !== null && pendingUnitIndex >= 0) {
        // Control frame pick - single file
        const file = files[0];
        if (file) {
          setUnitImage(pendingUnitIndex, file);
          setUnitParam(pendingUnitIndex, "processedImage", null);
        }
      } else {
        // Input frame pick - multiple files
        for (const file of files) void handleFile(file);
      }
      e.target.value = "";
      setPendingUnitIndex(null);
    },
    [pendingUnitIndex, handleFile, setUnitImage, setUnitParam],
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

  // Move overlay wrapper imperatively during pan/zoom gestures
  useEffect(() => {
    return mainViewportBus.subscribe((vp) => {
      if (!overlayRef.current) return;
      const storeVp = useCanvasStore.getState().viewport;
      const ratio = vp.scale / storeVp.scale;
      const dx = vp.x - storeVp.x * ratio;
      const dy = vp.y - storeVp.y * ratio;
      overlayRef.current.style.transform = `translate(${dx}px, ${dy}px) scale(${ratio})`;
    });
  }, []);

  // Reset overlay when store viewport changes programmatically (auto-fit, reset zoom)
  useEffect(() => {
    let prevVp = useCanvasStore.getState().viewport;
    return useCanvasStore.subscribe((state) => {
      if (state.viewport !== prevVp) {
        prevVp = state.viewport;
        if (overlayRef.current) overlayRef.current.style.transform = "";
      }
    });
  }, []);

  const handleClearAll = useCallback(() => {
    const state = useCanvasStore.getState();
    for (const frame of state.inputFrames) {
      state.clearLayersInFrame(frame.id);
      state.clearReferencesInFrame(frame.id);
    }
    clearMask();
  }, [clearMask]);

  const viewport = useCanvasStore((s) => s.viewport);
  const handlePickInputFile = useCallback((_frameId: string) => {
    // The new chrome's click handler already called setActiveInputFrame
    // before this runs, so handleFile (which reads activeInputFrameId on
    // input change) routes the picked file to the clicked frame.
    setPendingUnitIndex(-1);
    if (fileInputRef.current) {
      fileInputRef.current.multiple = true;
      fileInputRef.current.click();
    }
  }, []);
  const handleAddReferenceChild = useCallback((_frameId: string) => {
    setPendingUnitIndex(-1);
    if (fileInputRef.current) {
      fileInputRef.current.multiple = true;
      fileInputRef.current.click();
    }
  }, []);

  // Phase 10: +Add Input Frame from the column-bottom DOM button.
  // Creates a new Initial frame and focuses it so subsequent picks /
  // drops route there.
  const handleAddInputFrame = useCallback(() => {
    const state = useCanvasStore.getState();
    const newId = state.addInputFrame({ mode: "initial" });
    state.setActiveInputFrame(newId);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) void handleFile(file);
        }
      }
    },
    [handleFile],
  );

  const handlePickImage = useCallback((unitIndex: number) => {
    setPendingUnitIndex(unitIndex);
    if (fileInputRef.current) {
      fileInputRef.current.multiple = unitIndex === -1;
      fileInputRef.current.click();
    }
  }, []);

  const handleClearImage = useCallback(
    (unitIndex: number) => {
      setUnitImage(unitIndex, null);
      setUnitParam(unitIndex, "processedImage", null);
    },
    [setUnitImage, setUnitParam],
  );

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden${isOver ? " ring-2 ring-primary ring-inset" : ""}`}
      {...dropHandlers}
      onPaste={(e) => void handlePaste(e)}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- paste target needs focus
      tabIndex={0}
    >
      <CanvasStage
        layout={layout}
        onPickImage={handlePickImage}
        onPickInputFile={handlePickInputFile}
        onAddReferenceChild={handleAddReferenceChild}
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
        Phase 13 will rewire mask painting to be per-frame entirely; for
        now the toolbar still drives the global mask paint flow. */}
      {focusedFrameInitialHasImages && <CanvasToolbar />}

      {/* Generation progress overlay — not affected by pan/zoom */}
      <CanvasProgressOverlay />

      {/* Floating control panels — delta-transform wrapper for zero-render pan/zoom */}
      <div
        ref={overlayRef}
        style={{ position: "absolute", inset: 0, pointerEvents: "none", transformOrigin: "0 0" }}
      >
        <ControlFramePanels
          layout={layout}
          onPickImage={handlePickImage}
          onClearImage={handleClearImage}
          onClearAll={handleClearAll}
        />
        {/* Phase 7: per-Input-frame DOM chrome. Replaces the singular
            InputFramePanel (dropped from ControlFramePanels) and the
            multi-image ReferenceFilmstripOverlay (legacy, deleted in
            Phase 9). Mode toggle, action buttons, drawer, +Add Input
            Frame placeholder, and per-Reference-child X-button overlays
            all live here. */}
        <InputFramePanels
          layout={layout}
          viewport={viewport}
          labelScale={labelScale}
          onPickImage={handlePickInputFile}
          onAddReferenceChild={handleAddReferenceChild}
          onAddInputFrame={handleAddInputFrame}
        />
      </div>

      {/* Single file input for both input frame and control frame picks */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileInput}
        className="hidden"
      />
    </div>
  );
});
