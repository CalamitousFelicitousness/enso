// The saved frames, sets and recipes as a grid of cards, pinned first, then by use, so
// the next to leave the library is last; below them the entries an older
// build kept in this browser, until they are moved. One Tab stop per grid;
// arrows move between cards, by row as well as across.

import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLibrary } from "@/api/hooks/useMedia";
import { useProgressiveRender } from "@/hooks/useProgressiveRender";
import { useLegacyEntries } from "@/hooks/useLegacyEntries";
import { useMigration } from "@/inputs/migrate";
import { listOrder } from "@/lib/inputs/library";
import { LIBRARY_EMPTY, LIBRARY_NO_MATCH, libraryCountText } from "@/lib/inputs/text";
import { NOT_MOVED_HEADING } from "@/lib/media/text";
import { readRecipeHead } from "@/lib/recipes/recipe";
import type { ItemEntryV2 } from "@/api/types/media";
import { EntryCard } from "./EntryCard";
import { modelOfItem, modelOfStored, type EntryModel } from "./entryModel";
import { StayedList } from "./StayedList";

/** A recipe's model, which the search matches beside the name. */
function modelNameOf(item: ItemEntryV2): string {
  return item.recipe ? (readRecipeHead(item.recipe)?.checkpoint?.name ?? "") : "";
}

/** Cards rendered at once; more follow as the list scrolls. */
const BATCH = 20;

const STEP: Record<string, (columns: number) => number> = {
  ArrowLeft: () => -1,
  ArrowRight: () => 1,
  ArrowUp: (columns) => -columns,
  ArrowDown: (columns) => columns,
};

/** Cards in a grid with one Tab stop, rendered as the list scrolls. */
function EntryGrid({ entries, label }: { entries: EntryModel[]; label: string }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const { visibleItems, sentinelRef, hasMore, reveal } = useProgressiveRender(
    entries,
    BATCH,
    label,
  );
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
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const grid = gridRef.current;
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 1;
    let next: number | null = null;
    if (e.key in STEP) next = index + STEP[e.key](columns);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = entries.length - 1;
    if (next === null) return;
    e.preventDefault();
    const goal = Math.max(0, Math.min(entries.length - 1, next));
    const entry = entries[goal];
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
    <>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- arrow keys move focus between the cards' buttons, the grid's one Tab stop */}
      <div
        ref={gridRef}
        role="list"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="grid grid-cols-1 gap-2 @[20rem]:grid-cols-2"
      >
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
    </>
  );
}

export function SavedEntries({ query, active }: { query: string; active: boolean }) {
  const library = useLibrary(active);
  const legacy = useLegacyEntries(active);
  const stayed = useMigration((s) => s.skipped.size);
  const needle = query.trim().toLowerCase();
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle);

  const saved = library.data?.entries;
  const shown = useMemo(
    () => (saved ?? []).filter((e) => matches(e.name) || matches(modelNameOf(e))).map(modelOfItem),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matches reads needle
    [saved, needle],
  );
  const legacyShown = useMemo(
    () =>
      (legacy.data?.entries ?? [])
        .filter((e) => e.trashedAt === null && matches(e.name))
        .sort(listOrder)
        .map(modelOfStored),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matches reads needle
    [legacy.data, needle],
  );
  const pins = library.data?.pins.count ?? 0;
  const unpinnedCount = (saved ?? []).filter((e) => !e.pinned).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="@container flex flex-col gap-3 p-3">
          {saved && saved.length === 0 && legacyShown.length === 0 && (
            <p className="px-1 py-6 text-center text-2xs text-muted-foreground">{LIBRARY_EMPTY}</p>
          )}
          {saved && saved.length > 0 && shown.length === 0 && (
            <p className="px-1 py-6 text-center text-2xs text-muted-foreground">
              {LIBRARY_NO_MATCH}
            </p>
          )}
          {shown.length > 0 && <EntryGrid entries={shown} label="Saved items" />}
          {(legacyShown.length > 0 || stayed > 0) && (
            <section className="flex flex-col gap-2" aria-label={NOT_MOVED_HEADING}>
              <h4 className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
                {NOT_MOVED_HEADING}
              </h4>
              {legacyShown.length > 0 && (
                <EntryGrid entries={legacyShown} label={NOT_MOVED_HEADING} />
              )}
              <StayedList />
            </section>
          )}
        </div>
      </ScrollArea>
      <div className="flex h-7 shrink-0 items-center border-t border-border px-3 font-mono text-3xs tabular-nums text-muted-foreground">
        {library.data ? libraryCountText(unpinnedCount, library.data.cap, pins) : ""}
      </div>
    </div>
  );
}
