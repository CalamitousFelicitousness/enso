// One saved frame or set. Clicking a frame adds it to the inputs, clicking a
// set puts it in their place; the row under the name says which, and holds
// the other recall, Pin and Remove. Rename is in the menu and on F2, never on
// a double click, which would run the click twice.

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  MousePointerClick,
  Pencil,
  Pin,
  PinOff,
  Replace,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ActionSlot } from "@/components/ui/action-slot";
import { useDragSource } from "@/hooks/useDragSource";
import { useNearViewport } from "@/hooks/useNearViewport";
import { renameEntry, setPinned, trashEntry } from "@/inputs/library";
import { recallEntry, type RecallMode } from "@/inputs/recall";
import { useThumb } from "@/inputs/thumbs";
import { entryThumbs } from "@/lib/inputs/library";
import type { StoredEntry } from "@/lib/inputs/stored";
import {
  ADD_TO_INPUTS,
  entryLine,
  entryName,
  entryVerb,
  entryVerbHint,
  PIN_ENTRY,
  REMOVE_ENTRY,
  RENAME_ENTRY,
  REPLACE_INPUTS,
  UNPIN_ENTRY,
} from "@/lib/inputs/text";
import { cn } from "@/lib/utils";
import { EntryThumbs } from "./EntryThumbs";

const RECALL: Record<RecallMode, { label: string; icon: LucideIcon }> = {
  add: { label: ADD_TO_INPUTS, icon: ArrowDownToLine },
  replace: { label: REPLACE_INPUTS, icon: Replace },
};

function MenuItem({
  icon: Icon,
  label,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}) {
  return (
    <ContextMenuItem className="text-2xs" onSelect={onSelect}>
      <Icon size={14} />
      {label}
    </ContextMenuItem>
  );
}

interface EntryCardProps {
  entry: StoredEntry;
  /** 0 for the one card of the grid that Tab reaches. */
  tabIndex: 0 | -1;
  onFocusCard: (id: string) => void;
}

export function EntryCard({ entry, tabIndex, onFocusCard }: EntryCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const near = useNearViewport(cardRef);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const { pictures, more } = entryThumbs(entry);
  const first = pictures[0];
  const dragImage = useThumb(first && !first.missing ? { ...first, file: null } : null, near);
  const drag = useDragSource(
    renaming ? null : { type: "library-entry", entryId: entry.id, src: dragImage ?? undefined },
  );

  const primary: RecallMode = entry.kind === "set" ? "replace" : "add";
  const other: RecallMode = primary === "add" ? "replace" : "add";
  const { frames, size } = entry.inputs;

  const recall = (mode: RecallMode) => {
    if (busy) return;
    setBusy(true);
    void recallEntry(entry.id, mode).finally(() => setBusy(false));
  };
  const togglePin = () => void setPinned(entry.id, !entry.pinned);
  const remove = () => void trashEntry(entry.id);
  const startRename = () => setRenaming(true);

  useEffect(() => {
    if (!renaming) return;
    renameRef.current?.focus();
    renameRef.current?.select();
  }, [renaming]);

  const finishRename = (name: string | null) => {
    setRenaming(false);
    if (name !== null) void renameEntry(entry.id, name);
    requestAnimationFrame(() => mainRef.current?.focus());
  };

  /** The card's menu, opened from the keyboard where the pointer would. */
  const openMenu = () => {
    const card = cardRef.current;
    if (!card) return;
    const box = card.getBoundingClientRect();
    card.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: box.left + 16,
        clientY: box.top + 16,
      }),
    );
  };

  const onMainKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Delete") {
      e.preventDefault();
      remove();
    } else if (e.key === "F2") {
      e.preventDefault();
      startRename();
    } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      openMenu();
    }
  };

  const pinLabel = entry.pinned ? UNPIN_ENTRY : PIN_ENTRY;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-noninteractive-element-interactions -- a click anywhere on the card does what its main button does; the button is the control keyboards and screen readers reach */}
        <div
          ref={cardRef}
          role="listitem"
          data-entry-id={entry.id}
          aria-busy={busy || undefined}
          className={cn(
            "group flex min-w-0 flex-col rounded-md border border-border bg-card transition-colors hover:border-foreground/20",
            busy && "opacity-60",
          )}
          {...drag}
          onClick={(e) => {
            // the second click of a double click would recall it again
            if (e.detail > 1 || renaming) return;
            recall(primary);
          }}
        >
          <button
            ref={mainRef}
            type="button"
            data-entry-main
            tabIndex={tabIndex}
            aria-label={entryName(entry.name, entry.kind, frames, entry.pinned)}
            onFocus={() => onFocusCard(entry.id)}
            onKeyDown={onMainKeyDown}
            className="block w-full rounded-t-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <EntryThumbs pictures={pictures} more={more} active={near} />
          </button>
          <div className="flex min-w-0 flex-col gap-0.5 px-1.5 pt-1">
            <div className="flex min-w-0 items-center gap-1">
              {renaming ? (
                <input
                  ref={renameRef}
                  defaultValue={entry.name}
                  aria-label={RENAME_ENTRY}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") finishRename(e.currentTarget.value);
                    else if (e.key === "Escape") finishRename(null);
                  }}
                  onBlur={(e) => finishRename(e.currentTarget.value)}
                  className="h-5 min-w-0 flex-1 rounded border border-border bg-input/50 px-1 text-2xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-2xs" title={entry.name}>
                  {entry.name}
                </span>
              )}
              {entry.pinned && (
                <Pin size={10} className="shrink-0 text-muted-foreground" aria-hidden />
              )}
            </div>
            <span className="truncate text-4xs text-muted-foreground">
              {entryLine(entry.kind, frames, size)}
            </span>
          </div>
          <div className="flex h-6 items-center gap-0.5 px-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <span
              className="flex min-w-0 flex-1 items-center gap-0.5 text-4xs text-muted-foreground"
              title={entryVerbHint(entry.kind)}
            >
              <MousePointerClick size={10} className="shrink-0" aria-hidden />
              <span className="truncate">{entryVerb(entry.kind)}</span>
            </span>
            <ActionSlot
              label={RECALL[other].label}
              icon={RECALL[other].icon}
              reason={null}
              busy={busy}
              tabIndex={-1}
              onAct={() => recall(other)}
            />
            <ActionSlot
              label={pinLabel}
              icon={entry.pinned ? PinOff : Pin}
              reason={null}
              tabIndex={-1}
              onAct={togglePin}
            />
            <ActionSlot
              label={REMOVE_ENTRY}
              icon={Trash2}
              reason={null}
              tabIndex={-1}
              onAct={remove}
            />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <MenuItem {...RECALL[primary]} onSelect={() => recall(primary)} />
        <MenuItem {...RECALL[other]} onSelect={() => recall(other)} />
        <ContextMenuSeparator />
        <MenuItem icon={entry.pinned ? PinOff : Pin} label={pinLabel} onSelect={togglePin} />
        <MenuItem icon={Pencil} label={RENAME_ENTRY} onSelect={startRename} />
        <ContextMenuSeparator />
        <MenuItem icon={Trash2} label={REMOVE_ENTRY} onSelect={remove} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
