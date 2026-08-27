import { useCallback, useMemo, useRef } from "react";
import { Download, Trash2, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { useVideoStore } from "@/stores/videoStore";
import { useVideoCanvasStore, type VideoSlotId } from "@/stores/videoCanvasStore";
import { useActiveVideoCaps } from "@/hooks/useActiveVideoCaps";
import { videoViewport } from "@/canvas/viewportAdapter";
import { CanvasSurface, type SurfacePoint } from "@/canvas/CanvasSurface";
import { CanvasProgressOverlay } from "@/canvas/CanvasProgressOverlay";
import { VideoCompareStrip } from "./VideoCompareStrip";
import { compareLabel } from "@/lib/video/resultLabel";
import {
  useJobQueueStore,
  selectVideoActive,
  selectFramepackActive,
  selectLtxActive,
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
import { payloadToFile } from "@/lib/sendTo";
import type { DragPayload } from "@/stores/dragStore";
import { Button } from "@/components/ui/button";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { fileToBase64 } from "@/lib/image";
import { isStillResult } from "@/lib/video/results";
import {
  classifyReferenceFile,
  probeAudioFile,
  probeVideoFile,
  referenceAccept,
} from "@/lib/video/referenceMedia";
import { contrastText, resolveImageSrc } from "@/lib/utils";

// The picker admits reference video and audio, so the drop path has to as
// well. Which slot a file is legal for is decided once it has landed.
const acceptDroppedFile = (file: File) =>
  file.type.startsWith("image/") || classifyReferenceFile(file.name) !== null;

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
  const compareA = useVideoStore((s) => s.compareA);
  const compareB = useVideoStore((s) => s.compareB);
  const compareOpen = useVideoStore((s) => s.compareOpen);
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
  const compareLeft = useMemo(
    () => results.find((r) => r.id === compareA) ?? null,
    [results, compareA],
  );
  const compareRight = useMemo(
    () => results.find((r) => r.id === compareB) ?? null,
    [results, compareB],
  );
  const comparing = compareOpen && compareLeft !== null && compareRight !== null;

  // File input refs for click-to-pick
  const initInputRef = useRef<HTMLInputElement>(null);
  const lastInputRef = useRef<HTMLInputElement>(null);
  const referencesInputRef = useRef<HTMLInputElement>(null);

  const handlePickImage = useCallback((which: VideoSlotId) => {
    if (which === "init") initInputRef.current?.click();
    else if (which === "last") lastInputRef.current?.click();
    else referencesInputRef.current?.click();
  }, []);

  const refCaps = caps.references;
  const maxReferences = refCaps.max_total > 0 ? refCaps.max_total : refCaps.max_images;

  const handleFileSelected = useCallback(
    async (which: VideoSlotId, file: File) => {
      if (which !== "references") {
        if (!file.type.startsWith("image/")) {
          toast.warning(`The ${which === "init" ? "Init" : "Last"} slot takes an image`, {
            description: file.name,
          });
          return;
        }
        const base64 = await fileToBase64(file);
        const objectUrl = URL.createObjectURL(file);
        const img = new window.Image();
        img.src = objectUrl;
        await new Promise<void>((r) => {
          img.onload = () => r();
        });
        setFrame(which, file, base64, objectUrl, img.naturalWidth, img.naturalHeight);
        return;
      }

      const kind = classifyReferenceFile(file.name);
      if (!kind) {
        toast.warning(`Unsupported reference type: ${file.name}`);
        return;
      }
      const refs = useVideoCanvasStore.getState().references;
      const kindMax =
        kind === "image"
          ? refCaps.max_images
          : kind === "video"
            ? refCaps.max_videos
            : refCaps.max_audio;
      if (kind !== "image" && kindMax <= 0) {
        toast.warning("This model takes image references only");
        return;
      }
      if (kindMax > 0 && refs.filter((r) => r.kind === kind).length >= kindMax) {
        toast.warning(`This model takes at most ${kindMax} ${kind} references`);
        return;
      }
      if (maxReferences > 0 && refs.length >= maxReferences) {
        toast.warning(`This model takes at most ${maxReferences} references in total`);
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      try {
        if (kind === "image") {
          const base64 = await fileToBase64(file);
          const img = new window.Image();
          img.src = objectUrl;
          await new Promise<void>((r) => {
            img.onload = () => r();
          });
          addReference(file, base64, objectUrl, img.naturalWidth, img.naturalHeight, { kind });
        } else if (kind === "video") {
          const probe = await probeVideoFile(objectUrl);
          if (refCaps.video_max_seconds > 0 && probe.duration > refCaps.video_max_seconds) {
            URL.revokeObjectURL(objectUrl);
            if (probe.posterUrl) URL.revokeObjectURL(probe.posterUrl);
            toast.warning(`Reference videos are limited to ${refCaps.video_max_seconds}s`);
            return;
          }
          addReference(file, "", objectUrl, probe.width, probe.height, {
            kind,
            duration: probe.duration,
            hasAudio: probe.hasAudio,
            posterUrl: probe.posterUrl,
          });
        } else {
          const probe = await probeAudioFile(objectUrl);
          addReference(file, "", objectUrl, 0, 0, { kind, duration: probe.duration });
        }
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        toast.error(`Could not read ${file.name}`, {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [setFrame, addReference, refCaps, maxReferences],
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

  // Hit-test: which visible input slot a drop lands on; outside every band
  // falls back to the first visible input slot
  const hitTestTarget = useCallback(
    (point: SurfacePoint): VideoSlotId => {
      const bands: [VideoSlotId, number][] = [];
      if (layout.showInit) bands.push(["init", layout.initX]);
      if (layout.showLast) bands.push(["last", layout.lastX]);
      if (layout.showReferences) bands.push(["references", layout.referencesX]);
      for (const [slot, x] of bands) {
        if (point.canvasX >= x && point.canvasX < x + layout.displayW) return slot;
      }
      return bands[0]?.[0] ?? "init";
    },
    [layout],
  );

  const handleDropFiles = useCallback(
    (files: File[], point: SurfacePoint) => {
      const target = hitTestTarget(point);
      for (const file of files) void handleFileSelected(target, file);
    },
    [handleFileSelected, hitTestTarget],
  );

  const handleDropPayload = useCallback(
    (payload: DragPayload, point: SurfacePoint) => {
      const target = hitTestTarget(point);
      payloadToFile(payload)
        .then((f: File) => handleFileSelected(target, f))
        .catch(() => {});
    },
    [hitTestTarget, handleFileSelected],
  );

  // Paste targets the last slot the user touched, not a hardcoded one
  const handlePasteFiles = useCallback(
    (files: File[]) => {
      const file = files[0];
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
      void handleFileSelected(visible ? active : fallback, file);
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
    <CanvasSurface
      viewport={videoViewport}
      onDropFiles={handleDropFiles}
      onDropPayload={handleDropPayload}
      onPasteFiles={handlePasteFiles}
      acceptFile={acceptDroppedFile}
      below={results.length > 0 ? <VideoCompareStrip /> : null}
      overlay={
        <>
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

          {/* The player sits in the overlay slot rather than pinned to the
              container: pan only commits to the store on release, so a
              player positioned from the store viewport trails the cursor
              and escapes its frame for the length of a drag. */}
          {showVideoOverlay && (
            <div
              className="absolute overflow-hidden"
              style={{
                left: `${outputScreenX}px`,
                top: `${outputScreenY}px`,
                width: `${outputScreenW}px`,
                height: `${outputScreenH}px`,
                pointerEvents: comparing || selectedResult?.videoUrl ? "auto" : "none",
              }}
            >
              {comparing ? (
                <VideoCompare
                  leftSrc={resolveImageSrc(compareLeft.videoUrl)}
                  rightSrc={resolveImageSrc(compareRight.videoUrl)}
                  leftLabel={compareLabel("A", compareLeft)}
                  rightLabel={compareLabel("B", compareRight)}
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
        </>
      }
    >
      <VideoCanvasStage layout={layout} onPickImage={handlePickImage} />

      <CanvasProgressOverlay select={selectVideoDomainActiveJob} />

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
        accept={referenceAccept(refCaps)}
        multiple
        className="hidden"
        onChange={handleInputChange("references")}
      />
    </CanvasSurface>
  );
}
