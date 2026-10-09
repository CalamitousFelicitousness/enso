// The second line of a processed frame's dock: the source picture, the
// processor, what the frame shows, and Edit. Pointing at the source shows it
// in the frame; clicking it replaces the one picture, opens the frame's
// pictures, or selects the frame the picture comes from. Nothing of it sits
// on the picture.

import { useCallback, useEffect, useRef } from "react";
import { Check, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import { useUiStore } from "@/stores/uiStore";
import { useThumb } from "@/inputs/thumbs";
import { replacePicture } from "@/inputs/edits";
import { revealFrame } from "@/inputs/reveal";
import type { MapSlot, OutlineEntry } from "@/lib/inputs/outline";
import type { FramePosition } from "@/lib/inputs/layout";
import {
  mapFailedText,
  mapStateWord,
  mapsWord,
  positionLabel,
  statusWord,
} from "@/lib/inputs/text";
import { composedPictures } from "@/lib/inputs/types";

type Tone = "map" | "pending" | "failed" | "quiet";

const TONE: Record<Tone, string> = {
  map: "text-fuchsia-300",
  pending: "text-amber-400",
  failed: "text-red-400",
  quiet: "text-muted-foreground",
};

/** Stop showing a frame's source, when it is the one shown. */
function endPeek(frameId: string): void {
  const canvas = useCanvasStore.getState();
  if (canvas.peekingFrameId === frameId) canvas.setPeekingFrame(null);
}

function toneOf(maps: MapSlot[]): Tone {
  if (maps.some((m) => m.state === "failed")) return "failed";
  return maps.every((m) => m.state === "current") ? "map" : "pending";
}

/** What the frame shows: its map, its source while pointed at or edited, or
 * where its maps stand; the frame's own state while it sends nothing. */
function shown(
  frame: FramePosition,
  entry: OutlineEntry,
  editing: boolean,
  peeking: boolean,
): { word: string; tone: Tone; reason: string | null } {
  // a sent frame without slots: the server has not listed its processors yet
  if (entry.maps.length === 0) {
    return { word: entry.status === "sent" ? "" : statusWord(entry), tone: "quiet", reason: null };
  }
  const failed = entry.maps.find((m) => m.state === "failed");
  const reason = failed ? mapFailedText(failed.reason ?? "") : null;
  const slot = frame.kind === "composed" ? frame.map : null;
  if (slot) {
    if (editing) return { word: "Editing source", tone: "map", reason };
    if (slot.state === "current") return { word: peeking ? "Source" : "Map", tone: "map", reason };
    return { word: mapStateWord(slot.state), tone: toneOf([slot]), reason };
  }
  const word = mapsWord(entry.maps) ?? "";
  return { word: word === "current" ? "Maps" : word, tone: toneOf(entry.maps), reason };
}

interface MapLineProps {
  frame: FramePosition;
  entry: OutlineEntry;
}

export function MapLine({ frame, entry }: MapLineProps) {
  const editing = useCanvasStore((s) => s.editingFrameId === frame.frameId);
  const peeking = useCanvasStore((s) => s.peekingFrameId === frame.frameId);
  const setEditingFrame = useCanvasStore((s) => s.setEditingFrame);
  const composed = frame.kind === "composed";
  const mapCurrent = composed && frame.map?.state === "current";
  const { word, tone, reason } = shown(frame, entry, editing, peeking);

  return (
    <>
      {composed && (
        <SourceThumb frameId={frame.frameId} entry={entry} canPeek={mapCurrent && !editing} />
      )}
      <span
        className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground"
        title={entry.processor ?? undefined}
      >
        {entry.processor}
      </span>
      {/* One width whatever it says, so the line never moves */}
      <span
        className={`w-24 shrink-0 truncate text-right text-[10px] font-medium ${TONE[tone]}`}
        title={reason ?? (word || undefined)}
      >
        {word}
      </span>
      {composed && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5 shrink-0"
          disabled={!mapCurrent && !editing}
          title={
            editing
              ? "Done: show the map again"
              : mapCurrent
                ? "Edit the source pictures under the map"
                : "Nothing to edit under: there is no map yet"
          }
          aria-pressed={editing}
          onClick={(e) => {
            setEditingFrame(editing ? null : frame.frameId);
            // the work moves to the canvas, where Escape ends Edit mode
            e.currentTarget.blur();
          }}
        >
          {editing ? <Check size={12} /> : <PencilLine size={12} />}
        </Button>
      )}
    </>
  );
}

interface SourceThumbProps {
  frameId: string;
  entry: OutlineEntry;
  /** The frame shows its map, so pointing here can show the source instead. */
  canPeek: boolean;
}

function SourceThumb({ frameId, entry, canPeek }: SourceThumbProps) {
  const link = useInputStore((s) => s.frames.find((f) => f.id === frameId)?.link ?? null);
  const sourceId = link?.frameId ?? frameId;
  const base = useInputStore((s) => {
    const source = s.frames.find((f) => f.id === sourceId);
    return source ? (composedPictures(source)[0] ?? null) : null;
  });
  const ownCount = useInputStore((s) => {
    const own = s.frames.find((f) => f.id === frameId);
    return own ? composedPictures(own).length : 0;
  });
  const setPeekingFrame = useCanvasStore((s) => s.setPeekingFrame);
  // the frame shows its map, so the source is decoded only for this
  const url = useThumb(base);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // A peek that can no longer show anything (the map went stale, Edit mode)
  // or a thumbnail that goes while pointed at never sees the pointer leave
  useEffect(() => {
    if (!canPeek) endPeek(frameId);
    return () => endPeek(frameId);
  }, [canPeek, frameId]);

  const action = link ? "select" : ownCount === 1 ? "replace" : "open";
  const where = positionLabel(entry.position);
  const label =
    action === "select"
      ? `Select ${positionLabel(entry.linkedTo ?? 0)}, whose picture ${where} uses`
      : action === "replace"
        ? `Replace the picture of ${where}`
        : `Show the pictures of ${where}`;

  const handleClick = useCallback(() => {
    if (action === "select") {
      revealFrame(sourceId);
    } else if (action === "replace") {
      fileInputRef.current?.click();
    } else {
      revealFrame(frameId);
      useUiStore.getState().setImagesSubTab("input");
    }
  }, [action, sourceId, frameId]);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) void replacePicture(frameId, file);
    },
    [frameId],
  );

  const peek = () => {
    if (canPeek) setPeekingFrame(frameId);
  };
  const unpeek = () => endPeek(frameId);

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={canPeek ? `${label}. Point at it to see the source.` : label}
        className="size-[18px] shrink-0 overflow-hidden rounded-sm border border-white/40 bg-black/60 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerEnter={peek}
        onPointerLeave={unpeek}
        onFocus={peek}
        onBlur={unpeek}
        onClick={handleClick}
      >
        {url && <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
      />
    </>
  );
}
