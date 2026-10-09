// The saved frames and sets as a grid of cards, pinned first, then by use, so
// the next to leave the library is last. One Tab stop for the grid; arrows
// move between cards, by row as well as across.

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { ActionSlot } from "@/components/ui/action-slot";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useProgressiveRender } from "@/hooks/useProgressiveRender";
import { deleteUnreadable, useLibrary } from "@/inputs/library";
import { LIBRARY_CAP, listOrder, pinned, unpinned } from "@/lib/inputs/library";
import {
  DELETE_ENTRY,
  LIBRARY_EMPTY,
  LIBRARY_NO_MATCH,
  libraryCountText,
  NEWER_ENTRY,
} from "@/lib/inputs/text";
import { EntryCard } from "./EntryCard";

/** Cards rendered at once; more follow as the list scrolls. */
const BATCH = 20;

const STEP: Record<string, (columns: number) => number> = {
  ArrowLeft: () => -1,
  ArrowRight: () => 1,
  ArrowUp: (columns) => -columns,
  ArrowDown: (columns) => columns,
};

function UnreadableRow({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      role="listitem"
      className="col-span-full flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5"
    >
      <span className="min-w-0 flex-1 truncate text-3xs text-muted-foreground">{NEWER_ENTRY}</span>
      <ActionSlot
        label={DELETE_ENTRY}
        icon={Trash2}
        reason={null}
        onAct={() => setConfirming(true)}
      />
      <ConfirmDialog
        open={confirming}
        title="Delete this saved entry?"
        description="A newer version of Enso saved it, and this version cannot read it. While it is kept, no removed picture is deleted from storage. Deleting it cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setConfirming(false);
          void deleteUnreadable(id);
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

export function SavedEntries({ query }: { query: string }) {
  const entries = useLibrary((s) => s.entries);
  const unreadable = useLibrary((s) => s.unreadable);
  const loaded = useLibrary((s) => s.loaded);
  const gridRef = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const saved = useMemo(
    () => [...entries.values()].filter((e) => e.trashedAt === null).sort(listOrder),
    [entries],
  );
  const needle = query.trim().toLowerCase();
  const shown = needle ? saved.filter((e) => e.name.toLowerCase().includes(needle)) : saved;
  const { visibleItems, sentinelRef, hasMore, reveal } = useProgressiveRender(shown, BATCH, needle);
  const tabStop = visibleItems.some((e) => e.id === focusId)
    ? focusId
    : (visibleItems[0]?.id ?? null);
  // a card the keys moved to before it was rendered
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    const card = gridRef.current?.querySelector<HTMLElement>(
      `[data-entry-id="${id}"] [data-entry-main]`,
    );
    if (!card) return;
    pendingFocus.current = null;
    card.focus();
  }, [visibleItems]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.hasAttribute("data-entry-main")) return;
    const id = target.closest<HTMLElement>("[data-entry-id]")?.dataset["entryId"];
    const index = shown.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const grid = gridRef.current;
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 1;
    let next: number | null = null;
    if (e.key in STEP) next = index + STEP[e.key](columns);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = shown.length - 1;
    if (next === null) return;
    e.preventDefault();
    const goal = Math.max(0, Math.min(shown.length - 1, next));
    const entry = shown[goal];
    const card = grid?.querySelector<HTMLElement>(
      `[data-entry-id="${entry.id}"] [data-entry-main]`,
    );
    if (card) {
      card.focus();
      return;
    }
    pendingFocus.current = entry.id;
    reveal(goal);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="@container p-3">
          {loaded && saved.length === 0 && unreadable.length === 0 && (
            <p className="px-1 py-6 text-center text-2xs text-muted-foreground">{LIBRARY_EMPTY}</p>
          )}
          {saved.length > 0 && shown.length === 0 && (
            <p className="px-1 py-6 text-center text-2xs text-muted-foreground">
              {LIBRARY_NO_MATCH}
            </p>
          )}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- arrow keys move focus between the cards' buttons, the grid's one Tab stop */}
          <div
            ref={gridRef}
            role="list"
            aria-label="Saved inputs"
            onKeyDown={onKeyDown}
            className="grid grid-cols-1 gap-2 @[20rem]:grid-cols-2"
          >
            {unreadable.map((id) => (
              <UnreadableRow key={id} id={id} />
            ))}
            {visibleItems.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                tabIndex={entry.id === tabStop ? 0 : -1}
                onFocusCard={setFocusId}
              />
            ))}
          </div>
          {hasMore && <div ref={sentinelRef} className="h-8" />}
        </div>
      </ScrollArea>
      <div className="flex h-7 shrink-0 items-center border-t border-border px-3 font-mono text-3xs tabular-nums text-muted-foreground">
        {libraryCountText(unpinned(saved).length, LIBRARY_CAP, pinned(saved).length)}
      </div>
    </div>
  );
}
