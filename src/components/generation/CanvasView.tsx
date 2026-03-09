import { useCallback, useRef, useEffect, memo, useState } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useControlStore } from "@/stores/controlStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useUiStore } from "@/stores/uiStore";
import { useShortcutScope } from "@/hooks/useShortcutScope";
import { useShortcut } from "@/hooks/useShortcut";
import { useDropTarget } from "@/hooks/useDropTarget";
import { payloadToFile } from "@/lib/sendTo";
import type { DragPayload } from "@/stores/dragStore";
import { fileToBase64 } from "@/lib/image";
import { CanvasStage } from "@/canvas/CanvasStage";
import { CanvasToolbar } from "@/canvas/CanvasToolbar";
import { ControlFramePanels } from "@/canvas/ControlFramePanel";
import { useControlFrameLayout } from "@/canvas/useControlFrameLayout";
import { getOrderedFrames } from "@/canvas/frameList";
import { ModeToggle } from "./ModeToggle";
import { RotateCcw, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export const CanvasView = memo(function CanvasView() {
  useShortcutScope("canvas");
  const setViewport = useCanvasStore((s) => s.setViewport);
  const addImageLayer = useCanvasStore((s) => s.addImageLayer);
  const clearLayers = useCanvasStore((s) => s.clearLayers);
  const hasLayers = useCanvasStore((s) => s.layers.length > 0);
  const inputRole = useCanvasStore((s) => s.inputRole);
  const clearMask = useImg2ImgStore((s) => s.clearMask);
  const canvasMode = useCanvasStore((s) => s.canvasMode);
  const focusedFrameId = useCanvasStore((s) => s.focusedFrameId);
  const setCanvasMode = useCanvasStore((s) => s.setCanvasMode);
  const setFocusedFrame = useCanvasStore((s) => s.setFocusedFrame);
  const bumpFocusFitTrigger = useCanvasStore((s) => s.bumpFocusFitTrigger);
  const modeLocked = useCanvasStore((s) => s.modeLocked);
  const setModeLocked = useCanvasStore((s) => s.setModeLocked);
  const viewport = useCanvasStore((s) => s.viewport);
  const setUnitImage = useControlStore((s) => s.setUnitImage);
  const setUnitParam = useControlStore((s) => s.setUnitParam);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pendingUnitIndex, setPendingUnitIndex] = useState<number | null>(null);

  const layout = useControlFrameLayout();

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const base64 = await fileToBase64(file);
      const objectUrl = URL.createObjectURL(file);
      const img = new window.Image();
      img.src = objectUrl;
      await new Promise<void>((r) => {
        img.onload = () => r();
      });
      addImageLayer(
        file,
        base64,
        objectUrl,
        img.naturalWidth,
        img.naturalHeight,
      );
    },
    [addImageLayer],
  );

  // Hit-test control frames, returning the unitIndex or -1 for canvas
  const hitTestControlFrame = useCallback(
    (e: React.DragEvent): number => {
      const container = containerRef.current;
      if (!container) return -1;
      const rect = container.getBoundingClientRect();
      const canvasX = (e.clientX - rect.left - viewport.x) / viewport.scale;
      const canvasY = (e.clientY - rect.top - viewport.y) / viewport.scale;
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
    [viewport, layout.controlFrames],
  );

  const handleCanvasFileDrop = useCallback(
    (file: File, e: React.DragEvent) => {
      const unit = hitTestControlFrame(e);
      if (unit >= 0) {
        setUnitImage(unit, file);
        setUnitParam(unit, "processedImage", null);
      } else {
        handleFile(file);
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
              handleFile(f);
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
        for (const file of files) handleFile(file);
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
  useShortcut("canvas-focus-prev", useCallback(() => {
    if (canvasMode !== "focus") return;
    const frames = getOrderedFrames(layout);
    const currentId = focusedFrameId ?? "output";
    const idx = frames.findIndex((f) => f.id === currentId);
    if (idx > 0) setFocusedFrame(frames[idx - 1].id);
  }, [canvasMode, layout, focusedFrameId, setFocusedFrame]));

  // Shortcut: next frame (focus mode only)
  useShortcut("canvas-focus-next", useCallback(() => {
    if (canvasMode !== "focus") return;
    const frames = getOrderedFrames(layout);
    const currentId = focusedFrameId ?? "output";
    const idx = frames.findIndex((f) => f.id === currentId);
    if (idx >= 0 && idx < frames.length - 1) setFocusedFrame(frames[idx + 1].id);
  }, [canvasMode, layout, focusedFrameId, setFocusedFrame]));

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

  const handleClearAll = useCallback(() => {
    clearLayers();
    clearMask();
  }, [clearLayers, clearMask]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) handleFile(file);
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
      onPaste={handlePaste}
      tabIndex={0}
    >
      <CanvasStage layout={layout} onPickImage={handlePickImage} />

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
        {hasLayers && (
          <Button
            variant="secondary"
            size="icon-xs"
            onClick={handleClearAll}
            title="Clear all layers and mask"
            className="bg-background/80 backdrop-blur-sm"
          >
            <X size={12} />
          </Button>
        )}
      </div>

      {/* Canvas toolbar for mask painting - only in initial mode with images */}
      {hasLayers && inputRole !== "reference" && <CanvasToolbar />}

      {/* Floating control panels (persistent, collapsible) */}
      <ControlFramePanels
        layout={layout}
        onPickImage={handlePickImage}
        onClearImage={handleClearImage}
        onClearAll={handleClearAll}
      />

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
