// The Library: saved frames and sets, brought back into the inputs by a click
// or a drag onto the canvas or the Input tab's list, and the trash, which
// keeps what was removed for the days set in Settings.

import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useLibrarySync } from "@/inputs/library";
import { LIBRARY_SUB_TABS, type LibrarySubTab } from "@/lib/constants";
import { useUiStore } from "@/stores/uiStore";
import { SavedEntries } from "./library/SavedEntries";
import { TrashSection } from "./library/TrashSection";

const OPTIONS = LIBRARY_SUB_TABS.map((tab) => ({
  value: tab.id,
  label: tab.label,
  icon: tab.icon,
}));

export function LibraryTab() {
  const visible = useKeepAliveVisible();
  const list = useUiStore((s) => s.panelSelections.librarySubTab);
  const setPanelSelection = useUiStore((s) => s.setPanelSelection);
  useLibrarySync(visible);
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
      {list === "trash" ? (
        <TrashSection query={query} active={visible} />
      ) : (
        <SavedEntries query={query} />
      )}
    </div>
  );
}
