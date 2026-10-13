import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useBrowserFiles,
  useDeleteFiles,
  useMoveFiles,
  useDownloadFiles,
  refreshFolder,
} from "@/api/hooks/useGallery";
import {
  deleteTrashed,
  emptyGalleryTrash,
  restoreTrashed,
  trashGalleryFiles,
  trashOffIn,
  useGalleryTrash,
} from "@/api/hooks/useGalleryTrash";
import { useSessionStore } from "@/api/session";
import type { GalleryFile } from "@/api/types/gallery";
import { useGalleryStore } from "@/stores/galleryStore";
import { useJobQueueStore } from "@/stores/jobStore";
import { useShortcut } from "@/hooks/useShortcut";
import { useShortcutScope } from "@/hooks/useShortcutScope";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { folderLabel } from "@/lib/gallery/folders";
import { galleryTargets, shownSelection } from "@/lib/gallery/selection";
import {
  DELETE_FILES_NOW,
  EMPTY_GALLERY_TRASH,
  MOVE_TO_TRASH,
  NOTHING_SELECTED,
  READING_TRASH,
  RESTORE,
  RESTORE_TO,
  TRASH_EMPTY,
  TRASH_UNREADABLE,
  deleteFilesNowText,
  deleteFilesNowTitle,
  emptyGalleryTrashText,
  moveManyText,
  moveManyTitle,
} from "@/lib/gallery/text";
import { filesRemovedByOthers, isTrashFolder, trashFiles } from "@/lib/gallery/trash";
import type { RemovedByOthers } from "@/lib/media/text";
import {
  Trash2,
  FolderInput,
  Download,
  CheckSquare,
  Square as SquareIcon,
  Eye,
  Undo2,
  FolderOutput,
  Eraser,
} from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { GalleryToolbar } from "./GalleryToolbar";
import { GalleryProgress } from "./GalleryProgress";
import { GalleryGrid } from "./GalleryGrid";
import { GalleryLightbox } from "./GalleryLightbox";
import { GalleryMetadata } from "./GalleryMetadata";
import { MoveToDialog } from "./MoveToDialog";
import type { GalleryAction, TrashFileActions } from "./galleryActions";
import { FolderOpen } from "lucide-react";

/** Up to this many files go to the trash at once; more are asked about first. */
const ASK_ABOVE = 50;

type Dialog =
  | { kind: "move-many"; files: GalleryFile[]; hidden: number; title: string }
  | { kind: "delete-now"; files: GalleryFile[]; others: RemovedByOthers }
  | { kind: "move"; files: GalleryFile[] }
  | { kind: "restore-to"; files: GalleryFile[] }
  | { kind: "empty"; asOf: number; total: number; bytes: number; others: RemovedByOthers };

/** The id of the Gallery card that has keyboard focus. */
function focusedCardId(): string | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return null;
  return el.closest<HTMLElement>("[data-gallery-file]")?.dataset["galleryFile"] ?? null;
}

/** The files a Gallery action takes, and how many selected files a search hides. */
function takeTargets(): { files: GalleryFile[]; hidden: number } {
  const s = useGalleryStore.getState();
  const files = galleryTargets({
    selectedIds: s.selectedIds,
    sortedFiles: s.sortedFiles,
    focusedId: focusedCardId(),
    selectedFile: s.selectedFile,
  });
  const hidden = s.selectedIds.size > 0 ? shownSelection(s.selectedIds, s.sortedFiles).hidden : 0;
  return { files, hidden };
}

const ids = (files: readonly GalleryFile[]) => files.flatMap((f) => (f.trash ? [f.trash.id] : []));

export function GalleryView() {
  const activeFolder = useGalleryStore((s) => s.activeFolder);
  const activeKept = useGalleryStore((s) => s.activeKept);
  const fileCount = useGalleryStore((s) => s.files.length);
  const metadataPanelOpen = useGalleryStore((s) => s.metadataPanelOpen);
  const selectionCount = useGalleryStore((s) => s.selectedIds.size);
  const lightboxOpen = useGalleryStore((s) => s.lightboxIndex !== null);
  const selectedFile = useGalleryStore((s) => s.selectedFile);
  const sortedFiles = useGalleryStore((s) => s.sortedFiles);
  const me = useSessionStore((s) => s.user);

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);

  const deleteMutation = useDeleteFiles();
  const moveMutation = useMoveFiles();
  const downloadMutation = useDownloadFiles();

  const isTrash = isTrashFolder(activeFolder);
  const visible = useKeepAliveVisible();
  useBrowserFiles(activeFolder);
  useShortcutScope("gallery", visible);

  // The Trash folder is the server's list: the query writes the store's files
  const trash = useGalleryTrash(visible);
  const trashOff = trashOffIn(trash.error);
  // With the store off nothing it held can be read or restored, so an earlier list goes
  const trashList = trashOff ? undefined : trash.data;
  // Why the Trash folder lists nothing it holds
  const unlisted = trashOff ?? (trash.error && !trashList ? TRASH_UNREADABLE : null);
  useEffect(() => {
    if (!isTrash) return;
    const store = useGalleryStore.getState();
    if (!trashList) {
      if (unlisted) store.setFiles([]);
      store.setLoadingFiles(trash.isPending);
      return;
    }
    const files = trashFiles(trashList.items);
    store.setFiles(files);
    store.setLoadProgress(files.length, files.length);
    store.setLoadingFiles(false);
  }, [isTrash, trashList, unlisted, trash.isPending]);

  // Auto-refresh: when a tracked job transitions into a terminal status, the
  // active folder may now have new outputs (or removals from cleanup). The
  // mtime check inside refreshFolder is cheap and no-ops when nothing changed,
  // so we fire on every completion rather than trying to match output paths
  // (JobResult.images carries url, not filesystem path).
  useEffect(() => {
    if (!visible || !activeFolder) return;
    const unsub = useJobQueueStore.subscribe((state, prev) => {
      if (state.jobs === prev.jobs) return;
      for (const [id, job] of state.jobs) {
        const before = prev.jobs.get(id);
        const wasTerminal =
          before &&
          (before.status === "completed" ||
            before.status === "failed" ||
            before.status === "cancelled");
        const isTerminal =
          job.status === "completed" || job.status === "failed" || job.status === "cancelled";
        if (isTerminal && !wasTerminal) {
          void refreshFolder(activeFolder);
          return;
        }
      }
    });
    return unsub;
  }, [visible, activeFolder]);

  // Mtime poll backstop: catches out-of-band file changes (CLI, file manager,
  // sync from another device) while the gallery is visible. Paused when the
  // KeepAlive wrapper hides this view.
  useEffect(() => {
    if (!visible || !activeFolder) return;
    const folder = activeFolder;
    const id = setInterval(() => {
      void refreshFolder(folder);
    }, 10_000);
    return () => clearInterval(id);
  }, [visible, activeFolder]);

  // A file the lightbox showed left the folder when it was read again
  useEffect(
    () =>
      useGalleryStore.subscribe((s, prev) => {
        if (prev.lightboxIndex !== null && s.lightboxIndex === null && s.selectionLeft) {
          toast.info("The file is no longer in this folder");
        }
      }),
    [],
  );

  const work = useCallback(async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  }, []);

  /** Puts keyboard focus on the card that took a removed card's place. */
  const refocus = useCallback((firstIndex: number) => {
    const next = useGalleryStore.getState().sortedFiles[firstIndex];
    if (!next) return;
    document.querySelector<HTMLElement>(`[data-gallery-file="${CSS.escape(next.id)}"]`)?.focus();
  }, []);

  const trashTargets = useCallback(() => {
    const { files, hidden } = takeTargets();
    if (files.length === 0) return void toast.info(NOTHING_SELECTED);
    if (files.length > ASK_ABOVE) {
      const s = useGalleryStore.getState();
      const whole =
        files.length === s.files.length && !s.searchQuery && s.activeFolder
          ? folderLabel(s.activeFolder, s.folders)
          : null;
      setDialog({ kind: "move-many", files, hidden, title: moveManyTitle(files.length, whole) });
      return;
    }
    const fromCard = focusedCardId() !== null;
    const first = useGalleryStore.getState().sortedFiles.indexOf(files[0]);
    void work(async () => {
      if ((await trashGalleryFiles(files, hidden)) && fromCard) refocus(first);
    });
  }, [work, refocus]);

  const deleteTargetsNow = useCallback(() => {
    const { files } = takeTargets();
    if (files.length === 0) return void toast.info(NOTHING_SELECTED);
    setDialog({ kind: "delete-now", files, others: filesRemovedByOthers(files, me) });
  }, [me]);

  const moveTargets = useCallback((kind: "move" | "restore-to") => {
    const { files } = takeTargets();
    if (files.length === 0) return void toast.info(NOTHING_SELECTED);
    setDialog({ kind, files });
  }, []);

  const downloadTargets = useCallback(() => {
    const { files } = takeTargets();
    if (files.length === 0) return void toast.info(NOTHING_SELECTED);
    downloadMutation.mutate(files.map((f) => f.fullPath));
  }, [downloadMutation]);

  const restoreTargets = useCallback(() => {
    const { files } = takeTargets();
    if (files.length === 0) return void toast.info(NOTHING_SELECTED);
    void work(() => restoreTrashed(ids(files)));
  }, [work]);

  const askEmpty = useCallback(() => {
    const list = trashList;
    if (!list || list.total === 0)
      return void toast.info(unlisted ?? (list ? TRASH_EMPTY : READING_TRASH));
    setDialog({
      kind: "empty",
      asOf: list.as_of,
      total: list.total,
      bytes: list.bytes,
      others: filesRemovedByOthers(trashFiles(list.items), me),
    });
  }, [trashList, unlisted, me]);

  // What the slots show without a click: whether anything is chosen
  const chosen = useMemo(
    () =>
      selectionCount > 0 ||
      (selectedFile !== null && sortedFiles.some((f) => f.id === selectedFile.id)),
    [selectionCount, selectedFile, sortedFiles],
  );
  const none = chosen ? null : NOTHING_SELECTED;

  const actions: GalleryAction[] = useMemo(() => {
    const deleteNow: GalleryAction = {
      id: "delete-now",
      label: DELETE_FILES_NOW,
      icon: Eraser,
      reason: none ?? (isTrash ? null : activeKept),
      busy: busy || deleteMutation.isPending,
      destructive: true,
      run: deleteTargetsNow,
    };
    const download: GalleryAction = {
      id: "download",
      label: "Download",
      icon: Download,
      reason: none,
      busy: downloadMutation.isPending,
      destructive: false,
      run: downloadTargets,
    };
    if (isTrash) {
      return [
        {
          id: "restore",
          label: RESTORE,
          icon: Undo2,
          reason: none,
          busy,
          destructive: false,
          run: restoreTargets,
        },
        deleteNow,
        {
          id: "restore-to",
          label: RESTORE_TO,
          icon: FolderOutput,
          reason: none,
          busy,
          destructive: false,
          run: () => moveTargets("restore-to"),
        },
        download,
      ];
    }
    return [
      {
        id: "trash",
        label: "Delete",
        icon: Trash2,
        reason: none ?? activeKept ?? trashOff,
        busy,
        destructive: true,
        run: trashTargets,
      },
      deleteNow,
      {
        id: "move",
        label: "Move",
        icon: FolderInput,
        reason: none ?? activeKept,
        busy: moveMutation.isPending,
        destructive: false,
        run: () => moveTargets("move"),
      },
      download,
    ];
  }, [
    none,
    isTrash,
    activeKept,
    trashOff,
    busy,
    deleteMutation.isPending,
    moveMutation.isPending,
    downloadMutation.isPending,
    deleteTargetsNow,
    downloadTargets,
    restoreTargets,
    moveTargets,
    trashTargets,
  ]);

  // The metadata panel acts on its own file, which a selection need not hold
  const fileActions: TrashFileActions | null = useMemo(
    () =>
      isTrash
        ? {
            restore: (file) => void work(() => restoreTrashed(ids([file]))),
            deleteNow: (file) =>
              setDialog({
                kind: "delete-now",
                files: [file],
                others: filesRemovedByOthers([file], me),
              }),
            busy,
          }
        : null,
    [isTrash, work, me, busy],
  );

  /** An action from a key or the palette: its reason when it cannot act. The
   * reason "nothing chosen" is left to the action, which also counts the
   * focused card. */
  const act = useCallback(
    (id: GalleryAction["id"]) => {
      const action = actions.find((a) => a.id === id);
      if (!action || action.busy) return;
      if (action.reason && action.reason !== NOTHING_SELECTED) toast.info(action.reason);
      else action.run();
    },
    [actions],
  );

  useShortcut("gallery-toggle-info", () => useGalleryStore.getState().toggleMetadataPanel());
  useShortcut("gallery-select-all", (e) => {
    e.preventDefault();
    useGalleryStore.getState().selectAll();
  });
  useShortcut(
    "gallery-deselect",
    () => useGalleryStore.getState().deselectAll(),
    selectionCount > 0,
  );
  // In the Trash folder, Delete deletes for good
  useShortcut("gallery-delete", () => act(isTrash ? "delete-now" : "trash"), visible);
  useShortcut("gallery-delete-now", () => act("delete-now"), visible);

  useRegisterCommand(
    {
      id: "gallery:select-all",
      label: "Select all in folder",
      group: "Gallery",
      keywords: ["select", "all", "highlight"],
      icon: CheckSquare,
      shortcutId: "gallery-select-all",
      run: () => useGalleryStore.getState().selectAll(),
    },
    visible,
  );
  useRegisterCommand(
    {
      id: "gallery:deselect-all",
      label: "Deselect all",
      group: "Gallery",
      keywords: ["clear selection", "unselect"],
      icon: SquareIcon,
      shortcutId: "gallery-deselect",
      run: () => useGalleryStore.getState().deselectAll(),
    },
    visible,
  );
  useRegisterCommand(
    {
      id: "gallery:delete-selected",
      label: "Delete selected",
      group: "Gallery",
      keywords: ["remove", "trash", "bin", "rm"],
      icon: Trash2,
      shortcutId: "gallery-delete",
      run: () => act("trash"),
    },
    visible && !isTrash,
  );
  useRegisterCommand(
    {
      id: "gallery:delete-selected-now",
      label: "Delete selected now",
      group: "Gallery",
      keywords: ["permanently", "erase", "destroy", "for good"],
      icon: Eraser,
      shortcutId: "gallery-delete-now",
      run: () => act("delete-now"),
    },
    visible,
  );
  useRegisterCommand(
    {
      id: "gallery:restore-selected",
      label: "Restore selected from the trash",
      group: "Gallery",
      keywords: ["undelete", "recover", "bring back", "trash"],
      icon: Undo2,
      run: () => act("restore"),
    },
    visible && isTrash,
  );
  useRegisterCommand(
    {
      id: "gallery:empty-trash",
      label: "Empty the Gallery trash",
      group: "Gallery",
      keywords: ["trash", "bin", "delete all", "free space"],
      icon: Eraser,
      run: askEmpty,
    },
    visible && isTrash,
  );
  useRegisterCommand(
    {
      id: "gallery:move-selected",
      label: "Move selected to folder",
      group: "Gallery",
      keywords: ["relocate", "organize", "transfer"],
      icon: FolderInput,
      run: () => act("move"),
    },
    visible && !isTrash,
  );
  useRegisterCommand(
    {
      id: "gallery:download-selected",
      label: "Download selected as zip",
      group: "Gallery",
      keywords: ["save", "export", "archive"],
      icon: Download,
      run: () => act("download"),
    },
    visible,
  );
  useRegisterCommand(
    {
      id: "gallery:toggle-metadata",
      label: "Toggle metadata panel",
      group: "Gallery",
      keywords: ["info", "details", "exif", "panel"],
      icon: Eye,
      shortcutId: "gallery-toggle-info",
      run: () => useGalleryStore.getState().toggleMetadataPanel(),
    },
    visible,
  );

  const filteredCount = useGalleryStore((s) => {
    if (!s.searchQuery) return s.files.length;
    const q = s.searchQuery.toLowerCase();
    return s.files.filter((f) => f.relativePath.toLowerCase().includes(q)).length;
  });

  const close = () => setDialog(null);
  const confirmDeleteNow = (files: GalleryFile[]) =>
    void work(async () => {
      if (isTrash) await deleteTrashed(ids(files));
      else await deleteMutation.mutateAsync(files.map((f) => f.fullPath)).catch(() => {});
      close();
    });

  if (!activeFolder) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <FolderOpen size={32} className="opacity-30" />
        <p className="text-sm">Select a folder to browse</p>
        <p className="text-xs opacity-60">Choose a folder from the left panel</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <GalleryToolbar
        totalCount={fileCount}
        filteredCount={filteredCount}
        actions={actions}
        trash={isTrash ? { list: trashList, unlisted, busy, onEmpty: askEmpty } : null}
      />

      <GalleryProgress />
      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
        <ResizablePanel defaultSize="70%" minSize="30%">
          <GalleryGrid
            actions={actions}
            trashEmpty={unlisted ?? (trashList ? TRASH_EMPTY : READING_TRASH)}
          />
        </ResizablePanel>
        {metadataPanelOpen && (
          <>
            <ResizableHandle />
            <ResizablePanel defaultSize="30%" minSize={200} maxSize="50%">
              <GalleryMetadata trash={fileActions} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      {lightboxOpen && <GalleryLightbox />}

      <ConfirmDialog
        open={dialog?.kind === "move-many"}
        title={dialog?.kind === "move-many" ? dialog.title : ""}
        description={moveManyText(trash.data?.days ?? 7)}
        confirmLabel={MOVE_TO_TRASH}
        pending={busy}
        onConfirm={() => {
          if (dialog?.kind !== "move-many") return;
          const { files, hidden } = dialog;
          void work(async () => {
            await trashGalleryFiles(files, hidden);
            close();
          });
        }}
        onCancel={close}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete-now"}
        title={
          dialog?.kind === "delete-now"
            ? deleteFilesNowTitle(
                dialog.files.length,
                dialog.files[0]?.relativePath.split("/").pop() ?? "",
                dialog.others.count > 0,
              )
            : ""
        }
        description={
          dialog?.kind === "delete-now"
            ? deleteFilesNowText(isTrash, dialog.files.length, dialog.others)
            : ""
        }
        confirmLabel={DELETE_FILES_NOW}
        destructive
        pending={busy}
        onConfirm={() => dialog?.kind === "delete-now" && confirmDeleteNow(dialog.files)}
        onCancel={close}
      />
      <ConfirmDialog
        open={dialog?.kind === "empty"}
        title={`${EMPTY_GALLERY_TRASH}?`}
        description={
          dialog?.kind === "empty"
            ? emptyGalleryTrashText(dialog.total, dialog.bytes, dialog.others)
            : ""
        }
        confirmLabel={EMPTY_GALLERY_TRASH}
        destructive
        pending={busy}
        onConfirm={() => {
          if (dialog?.kind !== "empty") return;
          const { asOf } = dialog;
          void work(async () => {
            await emptyGalleryTrash(asOf);
            close();
          });
        }}
        onCancel={close}
      />
      <MoveToDialog
        open={dialog?.kind === "move" || dialog?.kind === "restore-to"}
        mode={dialog?.kind === "restore-to" ? "restore" : "move"}
        count={dialog?.kind === "move" || dialog?.kind === "restore-to" ? dialog.files.length : 0}
        isPending={busy || moveMutation.isPending}
        onConfirm={(destination) => {
          if (dialog?.kind === "move") {
            moveMutation.mutate(
              { files: dialog.files.map((f) => f.fullPath), destination },
              { onSettled: close },
            );
          } else if (dialog?.kind === "restore-to") {
            const restoring = ids(dialog.files);
            void work(async () => {
              await restoreTrashed(restoring, { folder: destination });
              close();
            });
          }
        }}
        onCancel={close}
      />
    </div>
  );
}
