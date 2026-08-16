import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Trash2, Film, Columns2, X, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { useVideoStore } from "@/stores/videoStore";
import { useVideoCanvasStore, type VideoSlotId } from "@/stores/videoCanvasStore";
import { useActiveVideoCaps } from "@/hooks/useActiveVideoCaps";
import { videoViewportBus } from "@/canvas/viewportBus";
import {
  useJobQueueStore,
  selectVideoActive,
  selectFramepackActive,
  selectLtxActive,
  selectVideoProgress,
  selectFramepackProgress,
  selectLtxProgress,
  selectVideoDomainActiveJob,
} from "@/stores/jobStore";
import { useUiStore } from "@/stores/uiStore";
import { useVideoFrameLayout } from "@/canvas/useVideoFrameLayout";
import { VideoCanvasStage } from "@/canvas/VideoCanvasStage";
import { ReferenceSortableOverlay } from "@/canvas/ReferenceSortableOverlay";
import {
  FrameHeader,
  INPUT_COLOR_ACTIVE,
  INPUT_COLOR_INACTIVE,
  OUTPUT_COLOR,
} from "@/canvas/ControlFramePanel";
import { VideoPlayer } from "@/components/video/VideoPlayer";
import { VideoCompare } from "@/components/video/VideoCompare";
import { VideoResultActions } from "@/components/video/VideoResultActions";
import { useDropTarget } from "@/hooks/useDropTarget";
import { payloadToFile } from "@/lib/sendTo";
import type { DragPayload } from "@/stores/dragStore";
import { Button } from "@/components/ui/button";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { fileToBase64 } from "@/lib/image";
import { isStillResult } from "@/lib/video/results";
import { contrastText, cn, resolveImageSrc } from "@/lib/utils";

const DOMAIN_LABELS: Record<string, string> = {
  video: "Models",
  framepack: "FP",
  ltx: "LTX",
};

export function VideoCanvasView() {
  const layout = useVideoFrameLayout();
  const caps = useActiveVideoCaps();
  const viewport = useVideoCanvasStore((s) => s.viewport);
  const initFrame = useVideoCanvasStore((s) => s.initFrame);
  const lastFrame = useVideoCanvasStore((s) => s.lastFrame);
  const references = useVideoCanvasStore((s) => s.references);
  const setFrame = useVideoCanvasStore((s) => s.setFrame);
  const clearFrame = useVideoCanvasStore((s) => s.clearFrame);
  const addReference = useVideoCanvasStore((s) => s.addReference);
  const removeReference = useVideoCanvasStore((s) => s.removeReference);
  const clearReferences = useVideoCanvasStore((s) => s.clearReferences);
  const setActiveSlot = useVideoCanvasStore((s) => s.setActiveSlot);
  const labelScale = useUiStore((s) => s.canvasLabelScale);

  const results = useVideoStore((s) => s.results);
  const selectedResultId = useVideoStore((s) => s.selectedResultId);
  const selectResult = useVideoStore((s) => s.selectResult);
  const clearResults = useVideoStore((s) => s.clearResults);
  const initStrength = useVideoStore((s) => s.initStrength);
  const videoWidth = useVideoStore((s) => s.width);
  const videoHeight = useVideoStore((s) => s.height);
  const setParam = useVideoStore((s) => s.setParam);
  const sizeText = `${videoWidth}\u00d7${videoHeight}`;

  const selectedResult = useMemo(
    () => results.find((r) => r.id === selectedResultId) ?? null,
    [results, selectedResultId],
  );

  const isVideoActive = useJobQueueStore(selectVideoActive);
  const isFramepackActive = useJobQueueStore(selectFramepackActive);
  const isLtxActive = useJobQueueStore(selectLtxActive);
  const isGenerating = isVideoActive || isFramepackActive || isLtxActive;
  const videoProgress = useJobQueueStore(selectVideoProgress);
  const fpProgress = useJobQueueStore(selectFramepackProgress);
  const ltxProgress = useJobQueueStore(selectLtxProgress);
  const progress = Math.max(videoProgress, fpProgress, ltxProgress);
  const progressPct = Math.round(progress * 100);

  const activeVideoJob = useJobQueueStore(selectVideoDomainActiveJob);
  const stepInfo = activeVideoJob
    ? {
        step: activeVideoJob.step,
        steps: activeVideoJob.steps,
        textinfo: activeVideoJob.textinfo,
      }
    : null;

  // Compare mode
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<[string | null, string | null]>([null, null]);

  const handleCompareToggle = useCallback(() => {
    if (compareMode) {
      setCompareMode(false);
      setCompareIds([null, null]);
    } else if (results.length >= 2) {
      setCompareMode(true);
      setCompareIds([results[0]?.id ?? null, results[1]?.id ?? null]);
    }
  }, [compareMode, results]);

  const handleCompareSelect = useCallback(
    (id: string) => {
      if (!compareMode) {
        selectResult(id);
        return;
      }
      setCompareIds((prev) => {
        if (prev[0] === id) return prev;
        if (prev[1] === id) return prev;
        return [prev[1], id];
      });
    },
    [compareMode, selectResult],
  );

  const compareLeft = useMemo(
    () => results.find((r) => r.id === compareIds[0]) ?? null,
    [results, compareIds],
  );
  const compareRight = useMemo(
    () => results.find((r) => r.id === compareIds[1]) ?? null,
    [results, compareIds],
  );

  // File input refs for click-to-pick
  const initInputRef = useRef<HTMLInputElement>(null);
  const lastInputRef = useRef<HTMLInputElement>(null);
  const referencesInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handlePickImage = useCallback((which: VideoSlotId) => {
    if (which === "init") initInputRef.current?.click();
    else if (which === "last") lastInputRef.current?.click();
    else referencesInputRef.current?.click();
  }, []);

  const maxReferences = caps.references.max_images;

  const handleFileSelected = useCallback(
    async (which: VideoSlotId, file: File) => {
      if (!file.type.startsWith("image/")) return;
      if (
        which === "references" &&
        useVideoCanvasStore.getState().references.length >= maxReferences
      ) {
        toast.warning(`This model takes at most ${maxReferences} reference images`);
        return;
      }
      const base64 = await fileToBase64(file);
      const objectUrl = URL.createObjectURL(file);
      const img = new window.Image();
      img.src = objectUrl;
      await new Promise<void>((r) => {
        img.onload = () => r();
      });
      if (which === "references") {
        addReference(file, base64, objectUrl, img.naturalWidth, img.naturalHeight);
      } else {
        setFrame(which, file, base64, objectUrl, img.naturalWidth, img.naturalHeight);
      }
    },
    [setFrame, addReference, maxReferences],
  );

  const handleInputChange = useCallback(
    (which: VideoSlotId) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      void (async () => {
        for (const file of files.slice(0, which === "references" ? maxReferences : 1)) {
          await handleFileSelected(which, file);
        }
      })();
      e.target.value = "";
    },
    [handleFileSelected, maxReferences],
  );

  // Move overlay wrapper imperatively during pan/zoom gestures
  useEffect(() => {
    return videoViewportBus.subscribe((vp) => {
      if (!overlayRef.current) return;
      const storeVp = useVideoCanvasStore.getState().viewport;
      const ratio = vp.scale / storeVp.scale;
      const dx = vp.x - storeVp.x * ratio;
      const dy = vp.y - storeVp.y * ratio;
      overlayRef.current.style.transform = `translate(${dx}px, ${dy}px) scale(${ratio})`;
    });
  }, []);

  // Reset overlay when store viewport changes programmatically
  useEffect(() => {
    let prevVp = useVideoCanvasStore.getState().viewport;
    return useVideoCanvasStore.subscribe((state) => {
      if (state.viewport !== prevVp) {
        prevVp = state.viewport;
        if (overlayRef.current) overlayRef.current.style.transform = "";
      }
    });
  }, []);

  // Hit-test: which visible input slot a drop lands on; outside every band
  // falls back to the first visible input slot
  const hitTestTarget = useCallback(
    (e: React.DragEvent): VideoSlotId => {
      const vp = useVideoCanvasStore.getState().viewport;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const canvasX = (screenX - vp.x) / vp.scale;
      const bands: [VideoSlotId, number][] = [];
      if (layout.showInit) bands.push(["init", layout.initX]);
      if (layout.showLast) bands.push(["last", layout.lastX]);
      if (layout.showReferences) bands.push(["references", layout.referencesX]);
      for (const [slot, x] of bands) {
        if (canvasX >= x && canvasX < x + layout.displayW) return slot;
      }
      return bands[0]?.[0] ?? "init";
    },
    [layout],
  );

  const handleDropFile = useCallback(
    async (file: File, e: React.DragEvent) => {
      await handleFileSelected(hitTestTarget(e), file);
    },
    [handleFileSelected, hitTestTarget],
  );

  const { isOver, ...dropHandlers } = useDropTarget({
    onDropPayload: useCallback(
      (payload: DragPayload, e: React.DragEvent) => {
        const target = hitTestTarget(e);
        payloadToFile(payload)
          .then((f: File) => handleFileSelected(target, f))
          .catch(() => {});
      },
      [hitTestTarget, handleFileSelected],
    ),
    onFileDrop: (f, e) => void handleDropFile(f, e),
  });

  // Paste targets the last slot the user touched, not a hardcoded one
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      const file = item.getAsFile();
      if (!file) return;
      const active = useVideoCanvasStore.getState().activeSlot;
      const visible =
        (active === "init" && layout.showInit) ||
        (active === "last" && layout.showLast) ||
        (active === "references" && layout.showReferences);
      const fallback: VideoSlotId = layout.showInit
        ? "init"
        : layout.showReferences
          ? "references"
          : "last";
      await handleFileSelected(visible ? active : fallback, file);
    },
    [handleFileSelected, layout],
  );

  // Reference cells come frame-local from the layout; the sortable overlay
  // wants canvas coordinates.
  const referenceOverlayCells = useMemo(
    () => layout.referenceChildren.map((c) => ({ ...c, x: layout.referencesX + c.x })),
    [layout.referenceChildren, layout.referencesX],
  );

  const handleReferenceReorder = useCallback((activeId: string, overId: string) => {
    const store = useVideoCanvasStore.getState();
    const from = store.references.findIndex((r) => r.id === activeId);
    const to = store.references.findIndex((r) => r.id === overId);
    if (from < 0 || to < 0) return;
    store.reorderReference(from, to);
  }, []);

  // Compute output frame overlay position
  const { outputX, displayW, displayH } = layout;
  const outputScreenX = outputX * viewport.scale + viewport.x;
  const outputScreenY = viewport.y;
  const outputScreenW = displayW * viewport.scale;
  const outputScreenH = displayH * viewport.scale;
  const showVideoOverlay = outputScreenW > 0 && outputScreenH > 0;

  const initColor = initFrame ? INPUT_COLOR_ACTIVE : INPUT_COLOR_INACTIVE;
  const lastColor = lastFrame ? INPUT_COLOR_ACTIVE : INPUT_COLOR_INACTIVE;
  const referencesColor = references.length > 0 ? "#a78bfa" : INPUT_COLOR_INACTIVE;
  const initTextColor = contrastText(initColor);
  const lastTextColor = contrastText(lastColor);
  const referencesTextColor = contrastText(referencesColor);
  const outputTextColor = contrastText(OUTPUT_COLOR);

  return (
    <div
      className={cn("h-full flex flex-col", isOver && "ring-2 ring-primary ring-inset")}
      {...dropHandlers}
      onPaste={(e) => void handlePaste(e)}
      tabIndex={-1}
    >
      {/* Canvas + overlays */}
      <div className="flex-1 relative min-h-0">
        <VideoCanvasStage layout={layout} onPickImage={handlePickImage} />

        {/* Floating headers - delta-transform wrapper for zero-render pan/zoom */}
        <div
          ref={overlayRef}
          style={{ position: "absolute", inset: 0, pointerEvents: "none", transformOrigin: "0 0" }}
        >
          {/* Floating header: Init frame */}
          {layout.showInit && (
            <FrameHeader
              mode="panel"
              color={initColor}
              label="Init"
              canvasX={layout.initX}
              frameW={displayW}
              viewport={viewport}
              labelScale={labelScale}
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handlePickImage("init")}
                    title="Add image"
                    className="hover:bg-black/10"
                  >
                    <ImagePlus size={16} style={{ color: initTextColor }} />
                  </Button>
                  {initFrame && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => clearFrame("init")}
                      title="Clear"
                      className="hover:bg-black/10"
                    >
                      <Trash2 size={16} style={{ color: initTextColor }} />
                    </Button>
                  )}
                </>
              }
              drawer={
                <ParamSlider
                  label="Strength"
                  value={initStrength}
                  onChange={(v) => setParam("initStrength", v)}
                  min={0}
                  max={1}
                  step={0.05}
                />
              }
              collapsed={!initFrame}
              onToggleCollapsed={() => {
                /* drawer auto-shows when frame present */
              }}
            />
          )}

          {/* Floating header: Last frame */}
          {layout.showLast && (
            <FrameHeader
              mode="panel"
              color={lastColor}
              label="Last"
              canvasX={layout.lastX}
              frameW={displayW}
              viewport={viewport}
              labelScale={labelScale}
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handlePickImage("last")}
                    title="Add image"
                    className="hover:bg-black/10"
                  >
                    <ImagePlus size={16} style={{ color: lastTextColor }} />
                  </Button>
                  {lastFrame && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => clearFrame("last")}
                      title="Clear"
                      className="hover:bg-black/10"
                    >
                      <Trash2 size={16} style={{ color: lastTextColor }} />
                    </Button>
                  )}
                </>
              }
            />
          )}

          {/* Floating header: References mother frame */}
          {layout.showReferences && (
            <FrameHeader
              mode="panel"
              color={referencesColor}
              label="Refs"
              sizeText={`${references.length}/${maxReferences}`}
              canvasX={layout.referencesX}
              frameW={displayW}
              viewport={viewport}
              labelScale={labelScale}
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handlePickImage("references")}
                    title="Add reference images"
                    className="hover:bg-black/10"
                  >
                    <ImagePlus size={16} style={{ color: referencesTextColor }} />
                  </Button>
                  {references.length > 0 && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={clearReferences}
                      title="Clear references"
                      className="hover:bg-black/10"
                    >
                      <Trash2 size={16} style={{ color: referencesTextColor }} />
                    </Button>
                  )}
                </>
              }
            />
          )}

          {/* Per-reference-cell overlays: drag-reorder + hover-X remove,
           * shared with the Input frames. Pointer-down also focuses the
           * references slot so paste targets it. */}
          {layout.showReferences && referenceOverlayCells.length > 0 && (
            <ReferenceSortableOverlay
              cells={referenceOverlayCells}
              viewport={viewport}
              onReorder={handleReferenceReorder}
              onRemove={removeReference}
              onCellPointerDown={() => setActiveSlot("references")}
            />
          )}

          {/* Floating header: Output frame */}
          <FrameHeader
            mode="hat"
            color={OUTPUT_COLOR}
            label="Output"
            sizeText={sizeText}
            canvasX={outputX}
            frameW={displayW}
            viewport={viewport}
            labelScale={labelScale}
            actions={
              <>
                {selectedResult?.videoUrl && !isGenerating && (
                  <>
                    <VideoResultActions result={selectedResult} />

                    <a href={resolveImageSrc(selectedResult.videoUrl)} download>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Download"
                        className="hover:bg-black/10"
                      >
                        <Download size={16} style={{ color: outputTextColor }} />
                      </Button>
                    </a>
                  </>
                )}
              </>
            }
          />
        </div>

        {/* Video player overlay positioned at output frame */}
        {showVideoOverlay && (
          <div
            className="absolute overflow-hidden"
            style={{
              left: `${outputScreenX}px`,
              top: `${outputScreenY}px`,
              width: `${outputScreenW}px`,
              height: `${outputScreenH}px`,
              pointerEvents:
                selectedResult?.videoUrl || (compareMode && compareLeft?.videoUrl)
                  ? "auto"
                  : "none",
            }}
          >
            {compareMode && compareLeft?.videoUrl && compareRight?.videoUrl ? (
              <VideoCompare
                leftSrc={resolveImageSrc(compareLeft.videoUrl)}
                rightSrc={resolveImageSrc(compareRight.videoUrl)}
                leftLabel={DOMAIN_LABELS[compareLeft.domain] ?? compareLeft.domain}
                rightLabel={DOMAIN_LABELS[compareRight.domain] ?? compareRight.domain}
              />
            ) : !isGenerating && selectedResult?.videoUrl ? (
              isStillResult(selectedResult) ? (
                <img
                  src={resolveImageSrc(selectedResult.videoUrl)}
                  alt=""
                  className="size-full object-contain"
                />
              ) : (
                <VideoPlayer
                  src={resolveImageSrc(selectedResult.videoUrl)}
                  fps={selectedResult.fps}
                />
              )
            ) : null}
          </div>
        )}

        {/* Progress overlay during generation */}
        {isGenerating && (
          <div className="absolute inset-x-0 bottom-0 p-4 pointer-events-none">
            <div className="flex flex-col gap-1 bg-background/80 backdrop-blur-sm rounded-lg px-3 py-2">
              {stepInfo && (stepInfo.step > 0 || stepInfo.textinfo) && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {stepInfo.steps > 0 && (
                    <span className="font-mono tabular-nums">
                      Step {stepInfo.step}/{stepInfo.steps}
                    </span>
                  )}
                  {stepInfo.textinfo && (
                    <>
                      <span className="text-muted-foreground/40">|</span>
                      <span className="truncate">{stepInfo.textinfo}</span>
                    </>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-[width] duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground font-mono tabular-nums min-w-[3ch]">
                  {progressPct}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Hidden file inputs */}
        <input
          ref={initInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleInputChange("init")}
        />

        <input
          ref={lastInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleInputChange("last")}
        />

        <input
          ref={referencesInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleInputChange("references")}
        />
      </div>

      {/* Result strip */}
      {results.length > 0 && (
        <div className="flex-shrink-0 border-t border-border bg-muted/30 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <div className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-thin">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => handleCompareSelect(r.id)}
                  className={cn(
                    "flex-shrink-0 w-16 h-10 rounded border overflow-hidden relative group transition-all",
                    !compareMode && r.id === selectedResultId
                      ? "border-primary ring-1 ring-primary/30"
                      : compareMode && (r.id === compareIds[0] || r.id === compareIds[1])
                        ? "border-primary ring-1 ring-primary/30"
                        : "border-border hover:border-primary/40",
                  )}
                >
                  {r.thumbnailUrl ? (
                    <img
                      src={resolveImageSrc(r.thumbnailUrl)}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-muted">
                      <Film size={12} className="text-muted-foreground/50" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 px-0.5 bg-black/60">
                    <span className="text-5xs text-white/80 font-medium">
                      {DOMAIN_LABELS[r.domain] ?? r.domain}
                    </span>
                  </div>
                  {compareMode && r.id === compareIds[0] && (
                    <div className="absolute top-0 left-0 px-1 bg-primary text-primary-foreground text-5xs font-bold rounded-br">
                      A
                    </div>
                  )}
                  {compareMode && r.id === compareIds[1] && (
                    <div className="absolute top-0 left-0 px-1 bg-primary text-primary-foreground text-5xs font-bold rounded-br">
                      B
                    </div>
                  )}
                </button>
              ))}
            </div>
            {results.length >= 2 && (
              <Button
                variant={compareMode ? "default" : "ghost"}
                size="icon-sm"
                onClick={handleCompareToggle}
                title={compareMode ? "Exit compare" : "Compare two results"}
              >
                {compareMode ? <X size={12} /> : <Columns2 size={12} />}
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={clearResults} title="Clear history">
              <Trash2 size={12} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
