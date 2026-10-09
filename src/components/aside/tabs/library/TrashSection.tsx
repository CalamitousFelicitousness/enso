// The trash: what the inputs lost and what the library let go, newest first,
// each until the days set in Settings have passed. Restore puts an item back
// with Undo; Delete now and Empty delete for good and free the space.

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArchiveRestore, ImageOff, Trash2 } from "lucide-react";
import { ActionSlot } from "@/components/ui/action-slot";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { loadLibrary, useLibrary } from "@/inputs/library";
import { restoreEntry, restoreRemoval } from "@/inputs/recall";
import { useThumb } from "@/inputs/thumbs";
import { deleteNow, loadTrash, measureTrash, useTrash } from "@/inputs/trash";
import type { StoredEntry } from "@/lib/inputs/stored";
import { sweepPolicy } from "@/lib/inputs/sweep";
import {
  aboutSize,
  DELETE_NOW,
  emptyTrashText,
  NEWER_REMOVAL,
  RESTORE_FROM_TRASH,
  TRASH_EMPTY_LABEL,
  trashAgeText,
  trashCountText,
  trashEmptyText,
} from "@/lib/inputs/text";
import { byRemoval, entryItem, removalItem, type TrashItem } from "@/lib/inputs/trash";

/** The time, again every minute, for the "removed 3 h ago" lines. */
function useMinute(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    // a list that comes back into view catches up at once
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active]);
  return now;
}

/** Read the trash and the library when the list comes into view, and again
 * whenever the window comes back, then measure what Empty would free. */
function useTrashSync(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const read = () => void Promise.all([loadTrash(), loadLibrary()]);
    read();
    const again = () => {
      if (document.visibilityState === "visible") read();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [active]);
}

const deleteItems = (items: readonly TrashItem[]) => deleteNow(items).then(() => loadLibrary());

function TrashRow({ item, now }: { item: TrashItem; now: number }) {
  const thumb = item.thumb;
  const url = useThumb(thumb && !thumb.missing ? { ...thumb, file: null } : null);
  const restore = () =>
    void (item.source === "removal" ? restoreRemoval(item.key) : restoreEntry(item.key));
  return (
    <div className="flex h-full items-center gap-2 px-3">
      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded bg-muted/40">
        {url ? (
          <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />
        ) : (
          thumb?.missing && <ImageOff size={12} className="text-muted-foreground" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-2xs" title={item.title}>
          {item.title}
        </span>
        <span className="truncate text-4xs text-muted-foreground">
          {trashAgeText(item.removedAt, item.expiresAt, now)}
        </span>
      </span>
      <ActionSlot label={RESTORE_FROM_TRASH} icon={ArchiveRestore} reason={null} onAct={restore} />
      <ActionSlot
        label={DELETE_NOW}
        icon={Trash2}
        reason={null}
        onAct={() => void deleteItems([item])}
      />
    </div>
  );
}

function UnreadableRow({ id }: { id: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-dashed border-border px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-3xs text-muted-foreground">
        {NEWER_REMOVAL}
      </span>
      <ActionSlot
        label={DELETE_NOW}
        icon={Trash2}
        reason={null}
        onAct={() =>
          void deleteItems([{ id: `removal:${id}`, source: "removal", key: id } as TrashItem])
        }
      />
    </div>
  );
}

const isTrashed = (entry: StoredEntry): entry is StoredEntry & { trashedAt: number } =>
  entry.trashedAt !== null;

export function TrashSection({ query, active }: { query: string; active: boolean }) {
  useTrashSync(active);
  const removals = useTrash((s) => s.removals);
  const unreadable = useTrash((s) => s.unreadable);
  const days = useTrash((s) => s.days);
  const restoring = useTrash((s) => s.restoring);
  const reclaimable = useTrash((s) => s.reclaimable);
  const loaded = useTrash((s) => s.loaded);
  // the storage notice's Free space opens the list with Empty asked for
  const askEmpty = useTrash((s) => s.askEmpty);
  const entries = useLibrary((s) => s.entries);
  // what emptying frees follows what the trash lists
  useEffect(() => {
    if (active) void measureTrash();
  }, [active, removals, entries]);
  const now = useMinute(active);
  const [confirming, setConfirming] = useState(false);
  const closeEmpty = () => {
    setConfirming(false);
    useTrash.setState({ askEmpty: false });
  };
  const scrollRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const { removalMs } = sweepPolicy(days);
    return [
      ...[...removals].map(([key, removal]) => removalItem(key, removal, removalMs)),
      ...[...entries.values()].filter(isTrashed).map((entry) => entryItem(entry, removalMs)),
    ]
      .filter((item) => !restoring.has(item.id))
      .sort(byRemoval);
  }, [removals, entries, days, restoring]);
  const needle = query.trim().toLowerCase();
  const shown = needle ? items.filter((i) => i.title.toLowerCase().includes(needle)) : items;
  const removalCount = items.filter((i) => i.source === "removal").length;
  const summary =
    items.length > 0
      ? `${trashCountText(removalCount, items.length - removalCount)}${reclaimable === null ? "" : ` · ${aboutSize(reclaimable)}`}`
      : "";

  // eslint-disable-next-line react-hooks/incompatible-library -- @tanstack/react-virtual
  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 8,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate text-3xs text-muted-foreground" title={summary}>
          {summary}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-3xs"
          disabled={items.length === 0}
          onClick={() => setConfirming(true)}
        >
          {TRASH_EMPTY_LABEL}
        </Button>
      </div>
      {unreadable.map((id) => (
        <UnreadableRow key={id} id={id} />
      ))}
      {loaded && items.length === 0 && (
        <p className="px-4 py-6 text-center text-2xs text-muted-foreground">
          {trashEmptyText(days)}
        </p>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          role="list"
          aria-label="Trash"
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const item = shown[row.index];
            return (
              <div
                key={item.id}
                role="listitem"
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 w-full py-1"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <TrashRow item={item} now={now} />
              </div>
            );
          })}
        </div>
      </div>
      <ConfirmDialog
        open={(confirming || askEmpty) && items.length > 0}
        title="Empty the trash?"
        description={emptyTrashText(removalCount, items.length - removalCount, reclaimable)}
        confirmLabel="Delete all"
        destructive
        onConfirm={() => {
          closeEmpty();
          void deleteItems(items);
        }}
        onCancel={closeEmpty}
      />
    </div>
  );
}
