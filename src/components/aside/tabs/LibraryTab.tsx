// The Library: saved frames and sets, brought back into the inputs by a click
// or a drag onto the canvas or the Input tab's list, and the trash, which
// keeps what was removed for the days set in Settings. One status line under
// the header says when the library cannot be shown, or what still waits in
// this browser.

import { useEffect, useState } from "react";
import { Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useLibrary } from "@/api/hooks/useMedia";
import { storeOffIn } from "@/api/queryKeys";
import { useDropTarget } from "@/hooks/useDropTarget";
import { useLibraryReveal } from "@/inputs/library";
import { startMove, useMigration } from "@/inputs/migrate";
import {
  importRecipeFiles,
  pickRecipeFiles,
  stopRecipeTransfer,
  useRecipeTransfer,
} from "@/inputs/recipes";
import { LIBRARY_SUB_TABS, type LibrarySubTab } from "@/lib/constants";
import {
  CANCEL,
  LIBRARY_READ_FAILED,
  LOADING,
  MOVE,
  movingText,
  notMovedText,
  RETRY,
} from "@/lib/media/text";
import { isRecipeFile } from "@/lib/recipes/recipe";
import { IMPORT_FILE, RECIPE_FILES } from "@/lib/recipes/text";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/uiStore";
import { SavedEntries } from "./library/SavedEntries";
import { TrashSection } from "./library/TrashSection";

const OPTIONS = LIBRARY_SUB_TABS.map((tab) => ({
  value: tab.id,
  label: tab.label,
  icon: tab.icon,
}));

/** The one line under the header: the store off, the library unreadable,
 * loading, an export or import under way, a move under way, or what older
 * builds kept here. Its height and its one action's place are fixed. */
function LibraryStatus({ active }: { active: boolean }) {
  const library = useLibrary(active);
  const held = useMigration((s) => s.held);
  const progress = useMigration((s) => s.progress);
  const controller = useMigration((s) => s.controller);
  const transfer = useRecipeTransfer((s) => s.text);
  const off = storeOffIn(library.error);
  let text = "";
  let action: { label: string; run: () => void } | null = null;
  if (off !== null) text = off;
  else if (library.isError) {
    text = LIBRARY_READ_FAILED;
    action = { label: RETRY, run: () => void library.refetch() };
  } else if (library.isPending && active) text = LOADING;
  else if (transfer !== null) {
    text = transfer;
    action = { label: CANCEL, run: stopRecipeTransfer };
  } else if (controller) {
    text = progress
      ? movingText(progress.done, progress.total, progress.bytes, progress.totalBytes)
      : movingText(0, 0, 0, 0);
    action = { label: CANCEL, run: () => controller.abort() };
  } else if (held.entries + held.records > 0) {
    text = notMovedText(held.entries, held.records);
    action = { label: MOVE, run: () => void startMove() };
  }
  return (
    <div
      role="status"
      className="flex h-6 shrink-0 items-center gap-2 border-b border-border px-3 text-3xs text-muted-foreground"
    >
      <span className="min-w-0 flex-1 truncate" title={text}>
        {text}
      </span>
      {action && (
        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-3xs" onClick={action.run}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function LibraryTab() {
  const visible = useKeepAliveVisible();
  const list = useUiStore((s) => s.panelSelections.librarySubTab);
  const setPanelSelection = useUiStore((s) => s.setPanelSelection);
  const [query, setQuery] = useState("");
  // a card Show reveals is found whatever the search held
  useEffect(
    () =>
      useLibraryReveal.subscribe((s) => {
        if (s.id !== null) setQuery("");
      }),
    [],
  );
  const { isOver, ...dropHandlers } = useDropTarget({
    onFilesDrop: (files) => void importRecipeFiles(files),
    acceptFile: isRecipeFile,
    kinds: RECIPE_FILES,
  });

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col", isOver && "ring-2 ring-inset ring-primary/60")}
      {...dropHandlers}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <SegmentedControl<LibrarySubTab>
          options={OPTIONS}
          value={list}
          onValueChange={(value) => setPanelSelection("librarySubTab", value)}
          variant="icon-label"
        />
        <div className="flex min-w-36 flex-1 items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <Search
              size={12}
              className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={list === "trash" ? "Search the trash" : "Search the library"}
              aria-label={list === "trash" ? "Search the trash" : "Search the library"}
              className="h-7 pl-6 text-2xs"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={IMPORT_FILE}
            title={IMPORT_FILE}
            onClick={pickRecipeFiles}
          >
            <Upload size={14} />
          </Button>
        </div>
      </div>
      <LibraryStatus active={visible} />
      {list === "trash" ? (
        <TrashSection query={query} active={visible} />
      ) : (
        <SavedEntries query={query} active={visible} />
      )}
    </div>
  );
}
