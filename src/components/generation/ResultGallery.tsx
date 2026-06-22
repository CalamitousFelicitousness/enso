import { useGenerationStore } from "@/stores/generationStore";
import type { GenerationResult } from "@/stores/generationStore";
import { useComparisonStore } from "@/stores/comparisonStore";
import { useUiStore } from "@/stores/uiStore";
import { restoreFromResult } from "@/lib/requestBuilder";
import {
  cn,
  downloadImage,
  downloadAllAsZip,
  generateImageFilename,
  resolveImageSrc,
} from "@/lib/utils";
import { useDragSource } from "@/hooks/useDragSource";
import { useHorizontalWheel } from "@/hooks/useHorizontalWheel";
import { memo, useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FolderDown, Trash2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GenerationDiffDialog } from "@/components/generation/GenerationDiffDialog";
import { ResultThumbPreview } from "@/components/generation/ResultThumbPreview";
import { ResultThumbActions } from "@/components/generation/ResultThumbActions";

interface CompareCandidate {
  resultId: string;
  imageIndex: number;
}

export const ResultGallery = memo(function ResultGallery() {
  const results = useGenerationStore((s) => s.results);
  const selectedResultId = useGenerationStore((s) => s.selectedResultId);
  const selectedImageIndex = useGenerationStore((s) => s.selectedImageIndex);
  const selectImage = useGenerationStore((s) => s.selectImage);
  const clearResults = useGenerationStore((s) => s.clearResults);
  const thumbSize = useUiStore((s) => s.resultThumbSize);
  const setThumbSize = useUiStore((s) => s.setResultThumbSize);

  const [confirmAction, setConfirmAction] = useState<"downloadAll" | "clear" | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [diffResult, setDiffResult] = useState<GenerationResult | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    resultId: string;
    imageIndex: number;
  } | null>(null);
  const [compareCandidate, setCompareCandidate] = useState<CompareCandidate | null>(null);
  const [comparePickMode, setComparePickMode] = useState(false);
  const contextRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasResults = results.length > 0;

  useHorizontalWheel(scrollRef, hasResults);

  const handleClick = useCallback(
    (e: React.MouseEvent, resultId: string, imageIndex: number) => {
      if (comparePickMode && compareCandidate) {
        const resultA = useGenerationStore
          .getState()
          .results.find((r) => r.id === compareCandidate.resultId);
        const resultB = useGenerationStore.getState().results.find((r) => r.id === resultId);
        if (resultA && resultB) {
          const srcA = resolveImageSrc(resultA.images[compareCandidate.imageIndex]);
          const srcB = resolveImageSrc(resultB.images[imageIndex]);
          useComparisonStore.getState().openComparison(
            {
              src: srcA,
              label: "Image A",
              resultId: compareCandidate.resultId,
              imageIndex: compareCandidate.imageIndex,
            },
            { src: srcB, label: "Image B", resultId, imageIndex },
          );
        }
        setCompareCandidate(null);
        setComparePickMode(false);
        return;
      }

      if (e.shiftKey) {
        if (!compareCandidate) {
          setCompareCandidate({ resultId, imageIndex });
        } else {
          const resultA = useGenerationStore
            .getState()
            .results.find((r) => r.id === compareCandidate.resultId);
          const resultB = useGenerationStore.getState().results.find((r) => r.id === resultId);
          if (resultA && resultB) {
            const srcA = resolveImageSrc(resultA.images[compareCandidate.imageIndex]);
            const srcB = resolveImageSrc(resultB.images[imageIndex]);
            useComparisonStore.getState().openComparison(
              {
                src: srcA,
                label: "Image A",
                resultId: compareCandidate.resultId,
                imageIndex: compareCandidate.imageIndex,
              },
              { src: srcB, label: "Image B", resultId, imageIndex },
            );
          }
          setCompareCandidate(null);
        }
        return;
      }

      setCompareCandidate(null);
      setComparePickMode(false);
      selectImage(resultId, imageIndex);
    },
    [selectImage, compareCandidate, comparePickMode],
  );

  const handleDoubleClick = useCallback((resultId: string) => {
    const result = useGenerationStore.getState().results.find((r) => r.id === resultId);
    if (result) {
      restoreFromResult(result);
      toast.success("Settings restored from selected generation");
    }
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, resultId: string, imageIndex: number) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, resultId, imageIndex });
    },
    [],
  );

  const handleContextAction = useCallback(
    (action: "restore" | "compare" | "compareWith" | "beforeAfter") => {
      if (!contextMenu) return;
      const result = useGenerationStore
        .getState()
        .results.find((r) => r.id === contextMenu.resultId);
      const { resultId, imageIndex } = contextMenu;
      setContextMenu(null);
      if (!result) return;

      if (action === "restore") {
        restoreFromResult(result);
        toast.success("Settings restored from selected generation");
      } else if (action === "compare") {
        setDiffResult(result);
      } else if (action === "compareWith") {
        setCompareCandidate({ resultId, imageIndex });
        setComparePickMode(true);
        toast.info("Click another thumbnail to compare");
      } else if (action === "beforeAfter" && result.baseImage) {
        const srcA = result.baseImage;
        const srcB = resolveImageSrc(result.images[imageIndex]);
        useComparisonStore
          .getState()
          .openComparison(
            { src: srcA, label: "Before (base)", resultId, imageIndex },
            { src: srcB, label: "After (final)", resultId, imageIndex },
          );
      }
    },
    [contextMenu],
  );

  const handleCompareFromThumb = useCallback((resultId: string, imageIndex: number) => {
    setCompareCandidate({ resultId, imageIndex });
    setComparePickMode(true);
    toast.info("Click another thumbnail to compare");
  }, []);

  const handleDownload = useCallback(() => {
    if (!selectedResultId || selectedImageIndex === null) return;
    const result = results.find((r) => r.id === selectedResultId);
    if (!result || !result.images[selectedImageIndex]) return;
    const image = result.images[selectedImageIndex];
    const filename = generateImageFilename(result.info, selectedImageIndex);
    void downloadImage(image, filename);
  }, [results, selectedResultId, selectedImageIndex]);

  const totalImages = results.reduce((sum, r) => sum + r.images.length, 0);

  function handleConfirm() {
    if (confirmAction === "downloadAll") {
      setDownloading(true);
      downloadAllAsZip(results)
        .then(() => toast.success("Zip downloaded"))
        .catch(() => toast.error("Failed to create zip"))
        .finally(() => {
          setDownloading(false);
          setConfirmAction(null);
        });
    } else if (confirmAction === "clear") {
      clearResults();
      toast.success("History cleared");
      setConfirmAction(null);
    }
  }

  if (results.length === 0) {
    return (
      <div data-tour="result-gallery" className="text-2xs text-muted-foreground text-center py-2">
        No results yet
      </div>
    );
  }

  return (
    <div data-tour="result-gallery" className="flex flex-col gap-1">
      <div className="flex items-center gap-1 justify-between">
        {/* Thumb size control */}
        <div className="flex items-center gap-1 min-w-0">
          <Minus size={10} className="text-muted-foreground flex-shrink-0" />

          <Slider
            value={[thumbSize]}
            onValueChange={([v]) => setThumbSize(v)}
            min={40}
            max={160}
            step={4}
            className="w-16"
          />

          <Plus size={10} className="text-muted-foreground flex-shrink-0" />
        </div>

        <div className="flex items-center gap-1">
          {compareCandidate && (
            <button
              onClick={() => {
                setCompareCandidate(null);
                setComparePickMode(false);
              }}
              className="text-3xs text-amber-400 hover:text-amber-300 transition-colors"
            >
              Cancel compare
            </button>
          )}
          {selectedResultId && selectedImageIndex !== null && (
            <button
              onClick={handleDownload}
              title="Download image"
              className="p-1 rounded hover:bg-accent transition-colors"
            >
              <Download size={14} />
            </button>
          )}
          <button
            onClick={() => setConfirmAction("downloadAll")}
            title="Download all as zip"
            className="p-1 rounded hover:bg-accent transition-colors"
          >
            <FolderDown size={14} />
          </button>
          <button
            onClick={() => setConfirmAction("clear")}
            title="Clear history"
            className="p-1 rounded hover:bg-accent transition-colors text-destructive/70 hover:text-destructive"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex gap-1.5 overflow-x-auto">
        {results.map((result) =>
          result.images.length > 1 ? (
            <BatchTile
              key={result.id}
              result={result}
              size={thumbSize}
              selectedResultId={selectedResultId}
              selectedImageIndex={selectedImageIndex}
              compareCandidate={compareCandidate}
              comparePickMode={comparePickMode}
              onClick={handleClick}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
              onCompare={handleCompareFromThumb}
            />
          ) : (
            <ResultThumb
              key={result.id}
              item={{
                resultId: result.id,
                imageIndex: 0,
                image: result.images[0],
                key: `${result.id}-0`,
                hasBaseImage: !!result.baseImage,
              }}
              result={result}
              size={thumbSize}
              selected={result.id === selectedResultId && selectedImageIndex === 0}
              isCompareCandidate={
                compareCandidate?.resultId === result.id && compareCandidate?.imageIndex === 0
              }
              comparePickMode={comparePickMode}
              onClick={handleClick}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
              onCompare={handleCompareFromThumb}
            />
          ),
        )}
      </div>

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmAction === "downloadAll"
                ? "Download All Images"
                : confirmAction === "clear"
                  ? "Clear History"
                  : ""}
            </DialogTitle>
            <DialogDescription>
              {confirmAction === "downloadAll"
                ? `Download ${totalImages} image${totalImages === 1 ? "" : "s"} as a zip file?`
                : confirmAction === "clear"
                  ? `Remove all ${totalImages} image${totalImages === 1 ? "" : "s"} from history? This cannot be undone.`
                  : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmAction(null)}
              disabled={downloading}
            >
              Cancel
            </Button>
            <Button
              variant={confirmAction === "clear" ? "destructive" : "default"}
              size="sm"
              onClick={handleConfirm}
              disabled={downloading}
            >
              {downloading
                ? "Downloading..."
                : confirmAction === "downloadAll"
                  ? "Download"
                  : confirmAction === "clear"
                    ? "Clear"
                    : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          ref={contextRef}
          className="fixed z-50 min-w-36 rounded-md border bg-popover p-1 text-popover-foreground shadow-md text-2xs"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <button
            type="button"
            className="w-full text-left px-2 py-1 rounded-sm hover:bg-accent"
            onClick={() => handleContextAction("restore")}
          >
            Restore All
          </button>
          <button
            type="button"
            className="w-full text-left px-2 py-1 rounded-sm hover:bg-accent"
            onClick={() => handleContextAction("compare")}
          >
            Compare & Restore...
          </button>
          <button
            type="button"
            className="w-full text-left px-2 py-1 rounded-sm hover:bg-accent"
            onClick={() => handleContextAction("compareWith")}
          >
            Compare with...
          </button>
          {(() => {
            const r = results.find((r) => r.id === contextMenu.resultId);
            return r?.baseImage ? (
              <button
                type="button"
                className="w-full text-left px-2 py-1 rounded-sm hover:bg-accent"
                onClick={() => handleContextAction("beforeAfter")}
              >
                Before / After
              </button>
            ) : null;
          })()}
        </div>
      )}

      <GenerationDiffDialog
        open={diffResult !== null}
        onOpenChange={(open) => {
          if (!open) setDiffResult(null);
        }}
        result={diffResult}
      />
    </div>
  );
});

// Thumb size inside the expanded batch popover - larger than the strip so the
// popover reads as a "wide film strip".
const POPOVER_THUMB = 128;

interface BatchTileProps {
  result: GenerationResult;
  size: number;
  selectedResultId: string | null;
  selectedImageIndex: number | null;
  compareCandidate: CompareCandidate | null;
  comparePickMode: boolean;
  onClick: (e: React.MouseEvent, resultId: string, imageIndex: number) => void;
  onDoubleClick: (resultId: string) => void;
  onContextMenu: (e: React.MouseEvent, resultId: string, imageIndex: number) => void;
  onCompare: (resultId: string, imageIndex: number) => void;
}

const BatchTile = memo(function BatchTile({
  result,
  size,
  selectedResultId,
  selectedImageIndex,
  compareCandidate,
  comparePickMode,
  onClick,
  onDoubleClick,
  onContextMenu,
  onCompare,
}: BatchTileProps) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useHorizontalWheel(scrollRef, open);

  const count = result.images.length;
  const isSelected = result.id === selectedResultId;
  // Mirror the canvas selection: show the picked frame as the cover when this
  // batch owns the current selection, otherwise the first image.
  const coverIndex = isSelected && selectedImageIndex !== null ? selectedImageIndex : 0;
  const coverSrc = resolveImageSrc(result.images[coverIndex]);

  // Shift-click builds a compare pair across batches, so keep the popover open;
  // any other pick selects onto the canvas and dismisses it.
  const onPick = (e: React.MouseEvent, resultId: string, imageIndex: number) => {
    onClick(e, resultId, imageIndex);
    if (!e.shiftKey) setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          title={`Batch of ${count} - click to expand`}
          onContextMenu={(e) => onContextMenu(e, result.id, coverIndex)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen((o) => !o);
            }
          }}
          className="relative flex-shrink-0 cursor-pointer outline-none"
          style={{ width: size + 6, height: size }}
        >
          {/* Layered card backs peeking on the right hint at more frames. */}
          <div
            className="absolute top-1.5 bottom-1.5 right-0 rounded-sm border border-border/60 bg-muted"
            style={{ width: size }}
          />
          <div
            className="absolute top-1 bottom-1 rounded border border-border/60 bg-muted"
            style={{ width: size, right: 3 }}
          />
          {/* Cover */}
          <div
            className={cn(
              "absolute left-0 top-0 overflow-hidden rounded border-2 transition-colors",
              isSelected ? "border-primary" : "border-transparent hover:border-muted-foreground/30",
            )}
            style={{ width: size, height: size }}
          >
            <img src={coverSrc} alt="Batch cover" className="h-full w-full object-cover" />
            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-3xs leading-tight text-white tabular-nums">
              ×{count}
            </span>
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="w-auto max-w-[calc(100vw-2rem)] p-2"
      >
        <div ref={scrollRef} className="flex gap-1.5 overflow-x-auto">
          {result.images.map((img, ii) => (
            <ResultThumb
              key={`${result.id}-${ii}`}
              item={{
                resultId: result.id,
                imageIndex: ii,
                image: img,
                key: `${result.id}-${ii}`,
                hasBaseImage: !!result.baseImage,
              }}
              result={result}
              size={POPOVER_THUMB}
              selected={isSelected && selectedImageIndex === ii}
              isCompareCandidate={
                compareCandidate?.resultId === result.id && compareCandidate?.imageIndex === ii
              }
              comparePickMode={comparePickMode}
              onClick={onPick}
              onDoubleClick={onDoubleClick}
              onContextMenu={onContextMenu}
              onCompare={onCompare}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
});

interface ResultThumbProps {
  item: {
    resultId: string;
    imageIndex: number;
    image: string;
    key: string;
    hasBaseImage: boolean;
  };
  result: GenerationResult;
  size: number;
  selected: boolean;
  isCompareCandidate: boolean;
  comparePickMode: boolean;
  onClick: (e: React.MouseEvent, resultId: string, imageIndex: number) => void;
  onDoubleClick: (resultId: string) => void;
  onContextMenu: (e: React.MouseEvent, resultId: string, imageIndex: number) => void;
  onCompare: (resultId: string, imageIndex: number) => void;
}

const ResultThumb = memo(function ResultThumb({
  item,
  result,
  size,
  selected,
  isCompareCandidate,
  comparePickMode,
  onClick,
  onDoubleClick,
  onContextMenu,
  onCompare,
}: ResultThumbProps) {
  const src = resolveImageSrc(item.image);
  const dragProps = useDragSource({
    type: "result-image",
    resultId: item.resultId,
    imageIndex: item.imageIndex,
    src,
  });

  const [hovered, setHovered] = useState(false);
  const [previewRect, setPreviewRect] = useState<DOMRect | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = useCallback(() => {
    hoverTimer.current = setTimeout(() => {
      setHovered(true);
      if (thumbRef.current) setPreviewRect(thumbRef.current.getBoundingClientRect());
    }, 300);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHovered(false);
    setPreviewRect(null);
  }, []);

  return (
    <>
      <div
        ref={thumbRef}
        role="button"
        tabIndex={0}
        onClick={(e) => onClick(e, item.resultId, item.imageIndex)}
        onDoubleClick={() => onDoubleClick(item.resultId)}
        onContextMenu={(e) => onContextMenu(e, item.resultId, item.imageIndex)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick(e as unknown as React.MouseEvent, item.resultId, item.imageIndex);
          }
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={cn(
          "flex-shrink-0 rounded overflow-hidden border-2 transition-colors relative group",
          isCompareCandidate
            ? "border-amber-400 ring-1 ring-amber-400/50"
            : selected
              ? "border-primary"
              : comparePickMode
                ? "border-transparent hover:border-amber-400/50"
                : "border-transparent hover:border-muted-foreground/30",
        )}
        style={{ width: size, height: size }}
        {...dragProps}
      >
        <img src={src} alt="Result" className="w-full h-full object-cover" />

        {isCompareCandidate && (
          <span className="absolute bottom-0 left-0 right-0 bg-amber-400/80 text-black text-center text-3xs leading-tight">
            A
          </span>
        )}
        {/* Quick actions overlay on hover */}
        {!isCompareCandidate && size >= 48 && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <ResultThumbActions
              result={result}
              imageIndex={item.imageIndex}
              onCompare={() => onCompare(item.resultId, item.imageIndex)}
            />
          </div>
        )}
      </div>
      {hovered && previewRect && (
        <ResultThumbPreview result={result} imageIndex={item.imageIndex} anchorRect={previewRect} />
      )}
    </>
  );
});
