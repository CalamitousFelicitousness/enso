// One frame in the outline: its place, a glimpse of what it holds, what it
// sends and one word for its state, with the On switch and remove beside.
// Every slot keeps its width, so nothing moves between states.

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useInputStore } from "@/stores/inputStore";
import { useThumb } from "@/inputs/thumbs";
import { removeFrame, setFrameOn } from "@/inputs/edits";
import { frameColor } from "@/canvas/frameColors";
import type { OutlineEntry } from "@/lib/inputs/outline";
import {
  controlTypeLabel,
  linkedLabel,
  notSentLabel,
  positionLabel,
  roleLabel,
  sentLabel,
  statusWord,
} from "@/lib/inputs/text";
import {
  composedPictures,
  isComposed,
  slotPictures,
  type Frame,
  type Picture,
} from "@/lib/inputs/types";
import { cn } from "@/lib/utils";

function Thumb({ picture }: { picture: Picture }) {
  const url = useThumb(picture.file && { ...picture, file: picture.file });
  const box = "h-6 w-6 shrink-0 rounded";
  return url ? (
    <img src={url} alt="" className={cn(box, "object-cover")} />
  ) : (
    <span className={cn(box, "bg-muted/40")} />
  );
}

/** A composed frame shows its base picture; a set frame its first two and a count. */
function RowThumbs({ frame }: { frame: Frame }) {
  const pictures = isComposed(frame.role)
    ? composedPictures(frame).slice(0, 1)
    : slotPictures(frame);
  const shown = pictures.slice(0, 2);
  const more = pictures.length - shown.length;
  return (
    <span className="flex w-14 shrink-0 items-center gap-0.5">
      {shown.map((p) => (
        <Thumb key={p.id} picture={p} />
      ))}
      {more > 0 && <span className="text-4xs text-muted-foreground">+{more}</span>}
    </span>
  );
}

/** The second line: what the frame sends. */
function sendsText(entry: OutlineEntry, frame: Frame): string {
  switch (frame.role) {
    case "initial":
    case "reference":
      return sentLabel(entry.sent) ?? "";
    case "control":
      if (entry.linkedTo !== null) return linkedLabel(entry.linkedTo);
      // the type is on the first line; a model that needs none says nothing here
      return entry.status === "sent" && frame.control.model !== "None" ? frame.control.model : "";
    case "ipAdapter":
      return entry.status === "sent" ? frame.ipAdapter.adapter : "";
  }
}

interface OutlineRowProps {
  entry: OutlineEntry;
  selected: boolean;
  canRemove: boolean;
  onSelect: (frameId: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>, frameId: string) => void;
}

export function OutlineRow({ entry, selected, canRemove, onSelect, onKeyDown }: OutlineRowProps) {
  const frame = useInputStore((s) => s.frames.find((f) => f.id === entry.frameId));
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.frameId,
  });

  // A changed number flashes once, so a renumber is seen where it happened:
  // the span remounts on each change and the animation plays on mount.
  const sends = frame ? sendsText(entry, frame) : "";
  const [seen, setSeen] = useState({ sends, n: 0 });
  if (seen.sends !== sends) setSeen({ sends, n: seen.n + 1 });

  if (!frame) return null;
  const position = positionLabel(entry.position);
  const roleText =
    frame.role === "control" ? controlTypeLabel(frame.control.type) : roleLabel(frame.role);
  const state = statusWord(entry);
  const stateHint = entry.notSent ? notSentLabel(entry.notSent) : undefined;
  const accent = frameColor(frame.role, entry.status === "sent" || entry.status === "notSent");

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      role="option"
      aria-selected={selected}
      aria-label={`${position}, ${roleText}, ${state}`}
      tabIndex={selected ? 0 : -1}
      data-frame-id={entry.frameId}
      onClick={() => onSelect(entry.frameId)}
      onKeyDown={(e) => onKeyDown(e, entry.frameId)}
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-1.5 py-1 outline-none transition-colors",
        "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        selected ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/40",
        isDragging && "opacity-60",
      )}
    >
      <button
        type="button"
        className="w-4 shrink-0 text-2xs font-mono text-muted-foreground"
        style={{ cursor: "grab", touchAction: "none" }}
        title={`Drag to reorder ${position}`}
        aria-label={`Drag to reorder ${position}`}
        {...attributes}
        {...listeners}
      >
        {entry.position}
      </button>
      <RowThumbs frame={frame} />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex items-center gap-1.5 text-2xs">
          <i className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
          <span className="truncate">{roleText}</span>
        </span>
        <span className="flex items-center gap-1 text-3xs text-muted-foreground">
          <span key={seen.n} className={cn("truncate rounded px-0.5", seen.n > 0 && "renumbered")}>
            {sends}
          </span>
          <span className="shrink-0" title={stateHint}>
            {sends ? `· ${state}` : state}
          </span>
        </span>
      </span>
      <Switch
        checked={frame.enabled}
        onCheckedChange={(checked) => setFrameOn(entry.frameId, checked)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`${position} on`}
        className="shrink-0"
      />
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={(e) => {
          e.stopPropagation();
          removeFrame(entry.frameId);
        }}
        disabled={!canRemove}
        className="shrink-0 text-muted-foreground"
        title={canRemove ? `Remove ${position}` : "Cannot remove the only frame"}
        aria-label={canRemove ? `Remove ${position}` : "Cannot remove the only frame"}
      >
        <Trash2 size={11} />
      </Button>
    </div>
  );
}
