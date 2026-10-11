// The trash: what the inputs lost in this browser, what the server's library
// let go, and what an older build's library let go here, newest first, each
// until its time has passed. Restore puts an item back with Undo; Delete now
// and Empty delete for good: a removal here, an entry for everyone.

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArchiveRestore, ImageOff, Trash2 } from "lucide-react";
import { blobUrl } from "@/api/blobs";
import { useServerTrash } from "@/api/hooks/useMedia";
import { useSessionStore } from "@/api/session";
import { ActionSlot } from "@/components/ui/action-slot";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MediaImg } from "@/components/ui/media";
import { useMinute } from "@/hooks/useMinute";
import { useLegacyEntries } from "@/hooks/useLegacyEntries";
import { restoreEntry, restoreRemoval } from "@/inputs/recall";
import { useThumb } from "@/inputs/thumbs";
import { deleteNow, emptyTrash, loadTrash, measureTrash, useTrash } from "@/inputs/trash";
import type { StoredEntry } from "@/lib/inputs/stored";
import { sweepPolicy } from "@/lib/inputs/sweep";
import {
  DELETE_NOW,
  NEWER_REMOVAL,
  RESTORE_FROM_TRASH,
  TRASH_EMPTY_LABEL,
  trashAgeText,
  trashEmptyText,
} from "@/lib/inputs/text";
import {
  byRemoval,
  legacyEntryItem,
  removalItem,
  serverEntryItem,
  type TrashItem,
} from "@/lib/inputs/trash";
import {
  DELETE_FOR_EVERYONE,
  deleteForEveryoneText,
  emptyBothText,
  MOVE_FIRST,
  trashHeaderText,
  type RemovedByOthers,
} from "@/lib/media/text";

/** Read the removals when the list comes into view, and again whenever the
 * window comes back, since another tab may have changed them. */
function useTrashSync(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    void loadTrash();
    const again = () => {
      if (document.visibilityState === "visible") void loadTrash();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [active]);
}

function Thumb({ item }: { item: TrashItem }) {
  const local = item.thumb?.kind === "local" ? item.thumb.picture : null;
  const url = useThumb(local && !local.missing ? { ...local, file: null } : null);
  const thumb = item.thumb;
  if (thumb?.kind === "server") {
    return thumb.lost ? (
      <ImageOff size={12} className="text-muted-foreground" aria-hidden />
    ) : (
      <MediaImg
        image={blobUrl(thumb.hash)}
        alt=""
        loading="lazy"
        draggable={false}
        className="h-full w-full object-cover"
      />
    );
  }
  if (url) return <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />;
  return local?.missing ? (
    <ImageOff size={12} className="text-muted-foreground" aria-hidden />
  ) : null;
}

function TrashRow({ item, now, me }: { item: TrashItem; now: number; me: string | null }) {
  const [confirming, setConfirming] = useState(false);
  const legacy = item.source === "legacy";
  const restore = () =>
    void (item.source === "removal" ? restoreRemoval(item.key) : restoreEntry(item.key));
  // an entry someone else removed is deleted for them too: asked first
  const remove = () => {
    if (item.source === "entry" && item.by && item.by !== me) setConfirming(true);
    else void deleteNow(item);
  };
  return (
    <div className="flex h-full items-center gap-2 px-3">
      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded bg-muted/40">
        <Thumb item={item} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-2xs" title={item.title}>
          {item.title}
        </span>
        <span className="truncate text-4xs text-muted-foreground">
          {legacy
            ? `${trashAgeText(item, now)} · ${MOVE_FIRST.toLowerCase()}`
            : trashAgeText(item, now)}
        </span>
      </span>
      <ActionSlot
        label={RESTORE_FROM_TRASH}
        icon={ArchiveRestore}
        reason={legacy ? MOVE_FIRST : null}
        onAct={restore}
      />
      <ActionSlot
        label={item.source === "entry" ? DELETE_FOR_EVERYONE : DELETE_NOW}
        icon={Trash2}
        reason={legacy ? MOVE_FIRST : null}
        onAct={remove}
      />
      <ConfirmDialog
        open={confirming}
        title={DELETE_FOR_EVERYONE}
        description={deleteForEveryoneText(item.title, item.by ?? "")}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setConfirming(false);
          void deleteNow(item);
        }}
        onCancel={() => setConfirming(false)}
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
        onAct={() => void deleteNow({ source: "removal", key: id })}
      />
    </div>
  );
}

const isTrashed = (entry: StoredEntry): entry is StoredEntry & { trashedAt: number } =>
  entry.trashedAt !== null;

/** Who else removed the listed entries, for the Empty dialog. */
function removedByOthers(items: readonly TrashItem[], me: string | null): RemovedByOthers {
  const names = items
    .filter((i) => i.source === "entry" && i.by && i.by !== me)
    .map((i) => i.by ?? "");
  const distinct = new Set(names);
  return { count: names.length, name: distinct.size === 1 ? (names[0] ?? null) : null };
}

export function TrashSection({ query, active }: { query: string; active: boolean }) {
  useTrashSync(active);
  const removals = useTrash((s) => s.removals);
  const unreadable = useTrash((s) => s.unreadable);
  const localDays = useTrash((s) => s.days);
  const restoring = useTrash((s) => s.restoring);
  const reclaimable = useTrash((s) => s.reclaimable);
  const loaded = useTrash((s) => s.loaded);
  // the storage notice's Free space opens the list with Empty asked for
  const askEmpty = useTrash((s) => s.askEmpty);
  const server = useServerTrash(active);
  const legacy = useLegacyEntries(active);
  const me = useSessionStore((s) => s.user);
  // what emptying frees here follows what the trash lists
  useEffect(() => {
    if (active) void measureTrash();
  }, [active, removals]);
  const now = useMinute(active);
  const [confirming, setConfirming] = useState(false);
  const closeEmpty = () => {
    setConfirming(false);
    useTrash.setState({ askEmpty: false });
  };
  const scrollRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const { removalMs } = sweepPolicy(localDays);
    const days = server.data?.days ?? localDays;
    return [
      ...[...removals].map(([key, removal]) => removalItem(key, removal, removalMs)),
      ...(server.data?.entries ?? []).flatMap((entry) =>
        entry.trashed_at == null
          ? []
          : [serverEntryItem({ ...entry, trashed_at: entry.trashed_at }, days)],
      ),
      ...(legacy.data?.entries ?? []).filter(isTrashed).map((e) => legacyEntryItem(e, removalMs)),
    ]
      .filter((item) => !restoring.has(item.id))
      .sort(byRemoval);
  }, [removals, server.data, legacy.data, localDays, restoring]);
  const needle = query.trim().toLowerCase();
  const shown = needle ? items.filter((i) => i.title.toLowerCase().includes(needle)) : items;
  const removalKeys = items.filter((i) => i.source === "removal").map((i) => i.key);
  const entryIds = items.filter((i) => i.source === "entry").map((i) => i.key);
  const serverReclaimable = server.data?.reclaimable ?? null;
  const summary = trashHeaderText(
    removalKeys.length,
    entryIds.length,
    reclaimable,
    serverReclaimable,
  );
  const emptiable = removalKeys.length + entryIds.length > 0;

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
          disabled={!emptiable}
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
          {trashEmptyText(server.data?.days ?? localDays)}
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
                <TrashRow item={item} now={now} me={me} />
              </div>
            );
          })}
        </div>
      </div>
      <ConfirmDialog
        open={(confirming || askEmpty) && emptiable}
        title="Empty the trash?"
        description={emptyBothText(
          removalKeys.length,
          entryIds.length,
          removedByOthers(items, me),
          reclaimable,
          serverReclaimable,
        )}
        confirmLabel="Delete all"
        destructive
        onConfirm={() => {
          closeEmpty();
          void emptyTrash(removalKeys, entryIds, serverReclaimable);
        }}
        onCancel={closeEmpty}
      />
    </div>
  );
}
