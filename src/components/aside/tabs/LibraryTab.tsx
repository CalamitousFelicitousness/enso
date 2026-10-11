// The Library: saved frames and sets, brought back into the inputs by a click
// or a drag onto the canvas or the Input tab's list, and the trash, which
// keeps what was removed for the days set in Settings. One status line under
// the header says when the library cannot be shown, or what still waits in
// this browser.

import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useLibrary } from "@/api/hooks/useMedia";
import { storeOffIn } from "@/api/queryKeys";
import { useLegacyEntries } from "@/hooks/useLegacyEntries";
import { LIBRARY_SUB_TABS, type LibrarySubTab } from "@/lib/constants";
import { LIBRARY_READ_FAILED, LOADING, notMovedText, RETRY, storeOffText } from "@/lib/media/text";
import { useUiStore } from "@/stores/uiStore";
import { SavedEntries } from "./library/SavedEntries";
import { TrashSection } from "./library/TrashSection";

const OPTIONS = LIBRARY_SUB_TABS.map((tab) => ({
  value: tab.id,
  label: tab.label,
  icon: tab.icon,
}));

/** The one line under the header: the store off, the library unreadable,
 * loading, or the entries an older build kept here. Its height is fixed. */
function LibraryStatus({ active }: { active: boolean }) {
  const library = useLibrary(active);
  const legacy = useLegacyEntries(active);
  const off = storeOffIn(library.error);
  const notMoved = legacy.data?.entries.length ?? 0;
  let text = "";
  let retry = false;
  if (off !== null) text = storeOffText(off || null);
  else if (library.isError) {
    text = LIBRARY_READ_FAILED;
    retry = true;
  } else if (library.isPending && active) text = LOADING;
  else if (notMoved > 0) text = notMovedText(notMoved);
  return (
    <div
      role="status"
      className="flex h-6 shrink-0 items-center gap-2 border-b border-border px-3 text-3xs text-muted-foreground"
    >
      <span className="min-w-0 flex-1 truncate" title={text}>
        {text}
      </span>
      {retry && (
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-3xs"
          onClick={() => void library.refetch()}
        >
          {RETRY}
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <SegmentedControl<LibrarySubTab>
          options={OPTIONS}
          value={list}
          onValueChange={(value) => setPanelSelection("librarySubTab", value)}
          variant="icon-label"
        />
        <div className="relative min-w-36 flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={list === "trash" ? "Search the trash" : "Search saved inputs"}
            aria-label={list === "trash" ? "Search the trash" : "Search saved inputs"}
            className="h-7 pl-6 text-2xs"
          />
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
