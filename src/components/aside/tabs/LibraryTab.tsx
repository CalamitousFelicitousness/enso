// The Library: saved frames and sets, brought back into the inputs by a click
// or a drag onto the canvas or the Input tab's list.

import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { useLibrarySync } from "@/inputs/library";
import { SavedEntries } from "./library/SavedEntries";

export function LibraryTab() {
  const visible = useKeepAliveVisible();
  useLibrarySync(visible);
  const [query, setQuery] = useState("");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search saved inputs"
            aria-label="Search saved inputs"
            className="h-7 pl-6 text-2xs"
          />
        </div>
      </div>
      <SavedEntries query={query} />
    </div>
  );
}
