import { useState } from "react";
import { motion } from "motion/react";
import {
  Search,
  X,
  ArrowUpDown,
  ScanSearch,
  RefreshCw,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { SortMode } from "./types";

interface CommandBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  filterOpen: boolean;
  onFilterToggle: () => void;
  activeFilterCount: number;
  sort: SortMode;
  onSortChange: (sort: SortMode) => void;
  canScan: boolean;
  isScanPending: boolean;
  isRefreshPending: boolean;
  onCivitScan: () => void;
  onRefresh: () => void;
}

export function CommandBar({
  search,
  onSearchChange,
  filterOpen,
  onFilterToggle,
  activeFilterCount,
  sort,
  onSortChange,
  canScan,
  isScanPending,
  isRefreshPending,
  onCivitScan,
  onRefresh,
}: CommandBarProps) {
  const [searchFocused, setSearchFocused] = useState(false);

  return (
    <div
      className="flex items-stretch rounded-lg overflow-hidden border dark:border-white/[0.06] border-black/[0.06]"
    >
      {/* Filter zone */}
      <div className="flex items-center px-1.5 dark:bg-white/[0.02] bg-black/[0.02]">
        <button
          type="button"
          onClick={onFilterToggle}
          className={`size-8 flex items-center justify-center rounded-md transition-all relative
            ${filterOpen
              ? "text-primary drop-shadow-[0_0_5px_oklch(from_var(--primary)_l_c_h_/_0.5)]"
              : "text-muted-foreground/50 hover:text-primary"
            }`}
        >
          {filterOpen ? (
            <PanelLeftClose className="size-3.5" />
          ) : (
            <PanelLeftOpen className="size-3.5" />
          )}
          {activeFilterCount > 0 && !filterOpen && (
            <div className="absolute -top-1 -right-1 size-3.5 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-mono text-[0.5rem] font-semibold">
              {activeFilterCount}
            </div>
          )}
        </button>
      </div>

      {/* Glowing accent divider — left */}
      <div
        className="w-px self-stretch transition-all duration-200"
        style={{
          background: searchFocused
            ? "oklch(from var(--primary) l c h / 0.4)"
            : undefined,
          boxShadow: searchFocused
            ? "0 0 6px oklch(from var(--primary) l c h / 0.3)"
            : "none",
        }}
      >
        {!searchFocused && (
          <div className="size-full dark:bg-white/[0.06] bg-black/[0.06]" />
        )}
      </div>

      {/* Search zone */}
      <motion.div
        className="flex-1 relative flex items-center min-w-0"
        animate={{
          backgroundColor: searchFocused
            ? "oklch(from var(--primary) l c h / 0.04)"
            : "rgba(0,0,0,0.15)",
        }}
        transition={{ duration: 0.2 }}
      >
        <Search
          className={`absolute left-2.5 size-3.5 transition-colors duration-200 ${
            searchFocused ? "text-primary" : "text-muted-foreground/40"
          }`}
        />
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          className="w-full h-9 pl-8 pr-3 bg-transparent text-foreground placeholder:text-muted-foreground/40 outline-none text-[0.6875rem]"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute right-2 text-muted-foreground/50 hover:text-foreground transition-colors"
          >
            <X className="size-3" />
          </button>
        )}
      </motion.div>

      {/* Glowing accent divider — right */}
      <div
        className="w-px self-stretch transition-all duration-200"
        style={{
          background: searchFocused
            ? "oklch(from var(--primary) l c h / 0.4)"
            : undefined,
          boxShadow: searchFocused
            ? "0 0 6px oklch(from var(--primary) l c h / 0.3)"
            : "none",
        }}
      >
        {!searchFocused && (
          <div className="size-full dark:bg-white/[0.06] bg-black/[0.06]" />
        )}
      </div>

      {/* Action zone */}
      <div className="flex items-center gap-0.5 px-1.5 dark:bg-white/[0.02] bg-black/[0.02]">
        {/* Sort dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="size-8 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-primary hover:drop-shadow-[0_0_5px_oklch(from_var(--primary)_l_c_h_/_0.5)] transition-all"
            >
              <ArrowUpDown className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[120px]">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={sort}
              onValueChange={(v) => onSortChange(v as SortMode)}
            >
              <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="base-model">
                Base Model
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="recent">
                Recent
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* CivitAI scan */}
        {canScan && (
          <button
            type="button"
            disabled={isScanPending || isRefreshPending}
            onClick={onCivitScan}
            title="Scan CivitAI for missing previews & metadata"
            className="size-8 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-primary hover:drop-shadow-[0_0_5px_oklch(from_var(--primary)_l_c_h_/_0.5)] transition-all disabled:opacity-50"
          >
            {isScanPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ScanSearch className="size-3.5" />
            )}
          </button>
        )}

        {/* Refresh */}
        <button
          type="button"
          disabled={isRefreshPending || isScanPending}
          onClick={onRefresh}
          className="size-8 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-primary hover:drop-shadow-[0_0_5px_oklch(from_var(--primary)_l_c_h_/_0.5)] transition-all disabled:opacity-50"
        >
          <RefreshCw
            className={`size-3.5 ${isRefreshPending ? "animate-spin" : ""}`}
          />
        </button>
      </div>
    </div>
  );
}
