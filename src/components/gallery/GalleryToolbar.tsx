import { useCallback, useRef, useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useGalleryStore } from "@/stores/galleryStore";
import { useGalleryRefresh } from "@/api/hooks/useGallery";
import type { ResGalleryTrashV2 } from "@/api/types/media";
import { useRegisterCommand } from "@/lib/commandRegistry";
import type { GallerySortField, GallerySortDir } from "@/api/types/gallery";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { folderLabel } from "@/lib/gallery/folders";
import { shownSelection } from "@/lib/gallery/selection";
import {
  DELETED_FIRST,
  DELETED_LAST,
  EMPTY_GALLERY_TRASH,
  READING_TRASH,
  TRASH_EMPTY,
  hiddenBySearchText,
  trashFolderText,
} from "@/lib/gallery/text";
import { isTrashFolder } from "@/lib/gallery/trash";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { GalleryAction } from "./galleryActions";
import { GalleryActionSlot } from "./GalleryActionSlot";
import {
  Search,
  FolderOpen,
  PanelRight,
  CheckCheck,
  XSquare,
  LayoutGrid,
  Rows3,
  RefreshCw,
  Trash2,
  Eraser,
} from "lucide-react";

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "name-asc", label: "Name A-Z" },
  { value: "name-desc", label: "Name Z-A" },
  { value: "mtime-desc", label: "Newest" },
  { value: "mtime-asc", label: "Oldest" },
  { value: "size-desc", label: "Largest" },
  { value: "size-asc", label: "Smallest" },
  { value: "width-desc", label: "Widest" },
  { value: "width-asc", label: "Narrowest" },
];

// In the Trash folder the time is when a file went there
const TRASH_SORT_OPTIONS = SORT_OPTIONS.map((option) =>
  option.value === "mtime-desc"
    ? { ...option, label: DELETED_LAST }
    : option.value === "mtime-asc"
      ? { ...option, label: DELETED_FIRST }
      : option,
);

interface GalleryToolbarProps {
  totalCount: number;
  filteredCount: number;
  actions: GalleryAction[];
  /** The Trash folder's list and its Empty; null in a folder. */
  trash: {
    list: ResGalleryTrashV2 | undefined;
    /** Why the list is not shown: the store is off, or it could not be read. */
    unlisted: string | null;
    busy: boolean;
    onEmpty: () => void;
  } | null;
}

export function GalleryToolbar({ totalCount, filteredCount, actions, trash }: GalleryToolbarProps) {
  const sort = useGalleryStore((s) => s.sort);
  const setSort = useGalleryStore((s) => s.setSort);
  const setSearchQuery = useGalleryStore((s) => s.setSearchQuery);
  const thumbSize = useGalleryStore((s) => s.thumbSize);
  const setThumbSize = useGalleryStore((s) => s.setThumbSize);
  const activeFolder = useGalleryStore((s) => s.activeFolder);
  const folders = useGalleryStore((s) => s.folders);
  const layoutMode = useGalleryStore((s) => s.layoutMode);
  const setLayoutMode = useGalleryStore((s) => s.setLayoutMode);
  const metadataPanelOpen = useGalleryStore((s) => s.metadataPanelOpen);
  const toggleMetadataPanel = useGalleryStore((s) => s.toggleMetadataPanel);
  const selectedIds = useGalleryStore((s) => s.selectedIds);
  const sortedFiles = useGalleryStore((s) => s.sortedFiles);
  const selectedFile = useGalleryStore((s) => s.selectedFile);
  const selectAll = useGalleryStore((s) => s.selectAll);
  const deselectAll = useGalleryStore((s) => s.deselectAll);
  const { refresh, isRefreshing, canRefresh } = useGalleryRefresh();
  const visible = useKeepAliveVisible();

  useRegisterCommand(
    {
      id: "gallery:refresh",
      label: "Refresh gallery",
      group: "Gallery",
      keywords: ["reload", "rescan", "sync", "update"],
      icon: RefreshCw,
      run: refresh,
    },
    visible,
  );

  const [localSearch, setLocalSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback(
    (value: string) => {
      setLocalSearch(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setSearchQuery(value), 300);
    },
    [setSearchQuery],
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const sortValue = `${sort.field}-${sort.dir}`;
  const handleSortChange = (v: string) => {
    const [field, dir] = v.split("-") as [GallerySortField, GallerySortDir];
    setSort({ field, dir });
  };

  const isTrash = isTrashFolder(activeFolder);
  const folderDisplay = activeFolder ? folderLabel(activeFolder, folders) : null;
  const FolderIcon = isTrash ? Trash2 : FolderOpen;

  // What the slots act on: the selection the grid shows, else the clicked file
  const chosen = useMemo(() => {
    if (selectedIds.size > 0) {
      const { hidden } = shownSelection(selectedIds, sortedFiles);
      const shown = `${(selectedIds.size - hidden).toLocaleString("en-US")} selected`;
      return { text: hidden > 0 ? `${shown} · ${hiddenBySearchText(hidden)}` : shown, on: true };
    }
    const clicked = selectedFile && sortedFiles.some((f) => f.id === selectedFile.id);
    return clicked
      ? { text: selectedFile.relativePath.split("/").pop() ?? "", on: false }
      : { text: "Nothing selected", on: false };
  }, [selectedIds, sortedFiles, selectedFile]);

  const trashLine = trash
    ? (trash.unlisted ??
      (trash.list
        ? trashFolderText(trash.list.total, trash.list.bytes, trash.list.days)
        : READING_TRASH))
    : null;
  const emptyRefusal = trash
    ? (trash.unlisted ?? (trash.list ? (trash.list.total > 0 ? null : TRASH_EMPTY) : READING_TRASH))
    : null;

  return (
    <div className="flex flex-col border-b border-border flex-shrink-0" data-key-surface="gallery">
      {/* Path breadcrumb */}
      {folderDisplay && (
        <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border/50 bg-muted/30">
          <FolderIcon size={11} className="text-muted-foreground flex-shrink-0" />

          <span
            className="text-3xs text-muted-foreground truncate"
            title={isTrash ? folderDisplay : (activeFolder ?? "")}
          >
            {folderDisplay}
          </span>
        </div>
      )}

      {/* Selection bar: what the actions take, and the four actions */}
      <div
        className={cn(
          "flex items-center gap-1.5 px-3 py-1 border-b",
          chosen.on ? "bg-primary/5 border-primary/20" : "border-border/50",
        )}
      >
        <span
          className={cn(
            "min-w-0 truncate text-2xs font-mono tabular-nums",
            chosen.on ? "font-medium text-primary" : "text-muted-foreground",
          )}
        >
          {chosen.text}
        </span>
        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-3xs gap-1" onClick={selectAll}>
          <CheckCheck size={12} /> All
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-3xs gap-1"
          disabled={selectedIds.size === 0}
          onClick={deselectAll}
        >
          <XSquare size={12} /> None
        </Button>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actions.map((action) => (
            <GalleryActionSlot key={action.id} action={action} />
          ))}
        </div>
      </div>

      {/* The Trash folder's line: what it holds and how long, with Empty */}
      {trash && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-border/50">
          <span
            className="min-w-0 flex-1 truncate text-3xs text-muted-foreground"
            title={trashLine ?? ""}
          >
            {trashLine}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-5 shrink-0 gap-1 px-1.5 text-3xs",
              emptyRefusal || trash.busy ? "opacity-40" : "text-destructive hover:text-destructive",
            )}
            aria-disabled={emptyRefusal || trash.busy ? true : undefined}
            title={emptyRefusal ? `${EMPTY_GALLERY_TRASH}: ${emptyRefusal}` : EMPTY_GALLERY_TRASH}
            onClick={() => {
              if (emptyRefusal) toast.info(emptyRefusal);
              else if (!trash.busy) trash.onEmpty();
            }}
          >
            <Eraser size={12} /> {EMPTY_GALLERY_TRASH}
          </Button>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <div className="relative flex-1 max-w-xs">
          <Search
            size={13}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />

          <Input
            placeholder="Search files..."
            value={localSearch}
            onChange={(e) => handleSearch(e.target.value)}
            className="h-6 text-2xs pl-7"
          />
        </div>

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={refresh}
          disabled={!canRefresh}
          title="Refresh folder"
          aria-label="Refresh folder"
        >
          <RefreshCw size={13} className={isRefreshing ? "animate-spin" : undefined} />
        </Button>

        <Combobox
          value={sortValue}
          onValueChange={handleSortChange}
          options={isTrash ? TRASH_SORT_OPTIONS : SORT_OPTIONS}
          className="w-28 h-6 text-2xs"
        />

        <div className="flex items-center gap-1.5 min-w-[6.25rem]">
          <span className="text-3xs text-muted-foreground">Size</span>
          <Slider
            value={[thumbSize]}
            min={120}
            max={320}
            step={20}
            onValueChange={([v]) => setThumbSize(v)}
            className="w-16"
          />
        </div>

        <span className="text-3xs text-muted-foreground font-mono tabular-nums ml-auto whitespace-nowrap">
          {filteredCount === totalCount
            ? `${totalCount} file${totalCount !== 1 ? "s" : ""}`
            : `${filteredCount} / ${totalCount}`}
        </span>

        <div className="flex items-center border border-border rounded-md overflow-hidden">
          <Button
            variant="toggle-grouped"
            size="icon-xs"
            data-state={layoutMode === "grid" ? "on" : "off"}
            onClick={() => setLayoutMode("grid")}
            title="Grid layout"
          >
            <LayoutGrid size={13} />
          </Button>
          <Button
            variant="toggle-grouped"
            size="icon-xs"
            data-state={layoutMode === "masonry" ? "on" : "off"}
            onClick={() => setLayoutMode("masonry")}
            title="Masonry layout"
          >
            <Rows3 size={13} />
          </Button>
        </div>

        <Button
          variant="toggle"
          size="icon-xs"
          data-state={metadataPanelOpen ? "on" : "off"}
          onClick={toggleMetadataPanel}
          title="Toggle metadata panel (I)"
        >
          <PanelRight size={14} />
        </Button>
      </div>
    </div>
  );
}
