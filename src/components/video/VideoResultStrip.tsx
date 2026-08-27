import { memo, useCallback, useRef, useState } from "react";
import {
  Columns2,
  Download,
  FastForward,
  GitCompare,
  History,
  ImagePlus,
  Minus,
  Pin,
  PinOff,
  Plus,
  Scissors,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useHorizontalWheel } from "@/hooks/useHorizontalWheel";
import { useActiveVideoCaps } from "@/hooks/useActiveVideoCaps";
import { useUiStore } from "@/stores/uiStore";
import { useVideoStore, type CompareSlot } from "@/stores/videoStore";
import { MAX_PINNED } from "@/lib/video/history";
import {
  downloadResult,
  extendFrom,
  reuseSettings,
  sendCapturedFrameToInit,
  sendFirstFrameToInit,
  sendFrameToUpscaleFrom,
  sendLastFrameToInit,
  sendLastFrameToLast,
} from "@/lib/video/resultActions";
import { isStillResult } from "@/lib/video/results";
import { resolveImageSrc } from "@/lib/utils";
import { FramePickerDialog } from "./FramePickerDialog";
import { ParamDiffDialog } from "./ParamDiffDialog";
import { VideoResultPreview } from "./VideoResultPreview";
import { VideoResultTile } from "./VideoResultTile";
import type { VideoResult } from "@/api/types/video";

const HOVER_DELAY_MS = 300;

interface HoverState {
  result: VideoResult;
  rect: DOMRect;
}

/**
 * Everything the user has generated, newest first, in the Left Panel footer.
 *
 * This is the recall half of the two strips: it answers "what have I made",
 * while the Canvas Compare Strip holds the handful of takes being judged.
 */
export const VideoResultStrip = memo(function VideoResultStrip() {
  const results = useVideoStore((s) => s.results);
  const selectedResultId = useVideoStore((s) => s.selectedResultId);
  const compareA = useVideoStore((s) => s.compareA);
  const compareB = useVideoStore((s) => s.compareB);
  const thumbSize = useUiStore((s) => s.videoResultThumbSize);
  const setThumbSize = useUiStore((s) => s.setVideoResultThumbSize);
  const caps = useActiveVideoCaps();

  const scrollRef = useRef<HTMLDivElement>(null);
  useHorizontalWheel(scrollRef, results.length > 0);

  const [menuTarget, setMenuTarget] = useState<VideoResult | null>(null);
  const [framePickerFor, setFramePickerFor] = useState<VideoResult | null>(null);
  const [diffFor, setDiffFor] = useState<VideoResult | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [hover, setHover] = useState<HoverState | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSelect = useCallback((result: VideoResult) => {
    useVideoStore.getState().selectResult(result.id);
  }, []);

  const handleActivate = useCallback((result: VideoResult) => {
    reuseSettings(result);
  }, []);

  const handleContextMenu = useCallback((result: VideoResult) => {
    setMenuTarget(result);
  }, []);

  const handleHoverStart = useCallback((result: VideoResult, rect: DOMRect) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover({ result, rect }), HOVER_DELAY_MS);
  }, []);

  const handleHoverEnd = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHover(null);
  }, []);

  const handleTogglePin = useCallback((result: VideoResult) => {
    if (!useVideoStore.getState().togglePin(result.id)) {
      toast.warning(`Pin limit reached (${MAX_PINNED})`, {
        description: "Unpin a result to make room.",
      });
    }
  }, []);

  const handleSendToCompare = useCallback((result: VideoResult) => {
    useVideoStore.getState().sendToCompare(result.id);
  }, []);

  const handleSetSlot = useCallback((result: VideoResult, slot: CompareSlot) => {
    useVideoStore.getState().setCompareSlot(slot, result.id);
  }, []);

  const handleDelete = useCallback((result: VideoResult) => {
    useVideoStore.getState().removeResult(result.id);
  }, []);

  const renderActions = useCallback(
    (result: VideoResult) => (
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions -- bubble firewall; each action button owns its own keyboard handling
      <div
        className="absolute right-0 bottom-0 left-0 flex justify-center gap-0.5 bg-gradient-to-t from-black/80 to-transparent px-0.5 pt-3 pb-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <ActionBtn onClick={() => reuseSettings(result)} title="Reuse settings">
          <History size={10} />
        </ActionBtn>
        <ActionBtn
          onClick={() => handleTogglePin(result)}
          title={result.pinned ? "Unpin" : "Pin to the working set"}
        >
          {result.pinned ? <PinOff size={10} /> : <Pin size={10} />}
        </ActionBtn>
        <ActionBtn onClick={() => handleSendToCompare(result)} title="Send to compare">
          <Columns2 size={10} />
        </ActionBtn>
        <ActionBtn onClick={() => handleDelete(result)} title="Delete">
          <Trash2 size={10} />
        </ActionBtn>
      </div>
    ),
    [handleTogglePin, handleSendToCompare, handleDelete],
  );

  if (results.length === 0) {
    return (
      <div className="py-2 text-center text-2xs text-muted-foreground">No video results yet</div>
    );
  }

  const pinnedCount = results.filter((r) => r.pinned).length;
  const still = menuTarget ? isStillResult(menuTarget) : false;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1">
          <Minus size={10} className="flex-shrink-0 text-muted-foreground" />
          <Slider
            value={[thumbSize]}
            onValueChange={([v]) => setThumbSize(v)}
            min={40}
            max={120}
            step={4}
            className="w-16"
          />
          <Plus size={10} className="flex-shrink-0 text-muted-foreground" />
        </div>
        <button
          onClick={() => setConfirmClear(true)}
          title="Clear history"
          className="rounded p-1 text-destructive/70 transition-colors hover:bg-accent hover:text-destructive"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div ref={scrollRef} className="flex gap-1.5 overflow-x-auto">
            {results.map((result) => (
              <VideoResultTile
                key={result.id}
                result={result}
                height={thumbSize}
                selected={result.id === selectedResultId}
                slot={result.id === compareA ? "A" : result.id === compareB ? "B" : undefined}
                onSelect={handleSelect}
                onActivate={handleActivate}
                onContextMenu={handleContextMenu}
                onHoverStart={handleHoverStart}
                onHoverEnd={handleHoverEnd}
                actions={renderActions}
              />
            ))}
          </div>
        </ContextMenuTrigger>
        {menuTarget && (
          <ContextMenuContent className="w-56">
            <ContextMenuItem onClick={() => reuseSettings(menuTarget)}>
              <History size={14} /> Reuse settings
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleSendToCompare(menuTarget)}>
              <Columns2 size={14} /> Send to compare
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleSetSlot(menuTarget, "A")}>
              <Columns2 size={14} /> Set as A
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleSetSlot(menuTarget, "B")}>
              <Columns2 size={14} /> Set as B
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleTogglePin(menuTarget)}>
              {menuTarget.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              {menuTarget.pinned ? "Unpin" : "Pin to the working set"}
            </ContextMenuItem>
            <ContextMenuSeparator />
            {!still && (
              <>
                <ContextMenuItem onClick={() => void sendFirstFrameToInit(menuTarget)}>
                  <ImagePlus size={14} /> Send first frame to Init
                </ContextMenuItem>
                <ContextMenuItem onClick={() => void sendLastFrameToInit(menuTarget)}>
                  <ImagePlus size={14} /> Send last frame to Init
                </ContextMenuItem>
                {caps.last_image !== "ignored" && (
                  <ContextMenuItem onClick={() => void sendLastFrameToLast(menuTarget)}>
                    <ImagePlus size={14} /> Send last frame to Last
                  </ContextMenuItem>
                )}
                <ContextMenuItem onClick={() => setFramePickerFor(menuTarget)}>
                  <Scissors size={14} /> Extract frame...
                </ContextMenuItem>
                <ContextMenuItem onClick={() => void extendFrom(menuTarget)}>
                  <FastForward size={14} /> Extend video
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem onClick={() => void sendFrameToUpscaleFrom(menuTarget)}>
              <ImagePlus size={14} /> Send frame to Upscale
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setDiffFor(menuTarget)}>
              <GitCompare size={14} /> Compare settings...
            </ContextMenuItem>
            <ContextMenuItem onClick={() => downloadResult(menuTarget)}>
              <Download size={14} /> Download
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => handleDelete(menuTarget)}>
              <Trash2 size={14} /> Delete
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>

      {hover && <VideoResultPreview result={hover.result} anchorRect={hover.rect} />}

      {framePickerFor && (
        <FramePickerDialog
          videoUrl={resolveImageSrc(framePickerFor.videoUrl)}
          fps={framePickerFor.fps}
          open
          onOpenChange={(open) => !open && setFramePickerFor(null)}
          onCapture={sendCapturedFrameToInit}
        />
      )}

      {diffFor && (
        <ParamDiffDialog
          open
          onOpenChange={(open) => !open && setDiffFor(null)}
          resultParams={diffFor.params}
          domain={diffFor.domain}
        />
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear video history</DialogTitle>
            <DialogDescription>
              {`Remove ${results.length - pinnedCount} result${results.length - pinnedCount === 1 ? "" : "s"}?` +
                (pinnedCount > 0
                  ? ` ${pinnedCount} pinned result${pinnedCount === 1 ? "" : "s"} will be kept.`
                  : " This cannot be undone.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                useVideoStore.getState().clearResults();
                setConfirmClear(false);
              }}
            >
              Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

function ActionBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-5 w-5 items-center justify-center rounded text-white/80 transition-colors hover:bg-white/20 hover:text-white"
    >
      {children}
    </button>
  );
}
