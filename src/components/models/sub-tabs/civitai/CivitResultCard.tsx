import { useMemo } from "react";
import { Download, Bookmark, Ban, Check, Search, ExternalLink, Copy } from "lucide-react";
import { toast } from "sonner";
import type { CivitModel } from "@/api/types/civitai";
import {
  useCivitBookmarks,
  useCivitAddBookmark,
  useCivitRemoveBookmark,
  useCivitBanned,
  useCivitAddBanned,
  useCivitRemoveBanned,
} from "@/api/hooks/useCivitai";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { CivitFlags } from "./CivitFlags";

interface CivitResultCardProps {
  model: CivitModel;
  localFiles: Record<string, { filename: string; type: string }>;
  onClick: () => void;
  onSearchCreator: (creatorName: string) => void;
}

function civitThumbnail(url: string, width = 80): string {
  // CivitAI CDN uses path-based sizing: /width=450/ or /original=true/
  return url.replace(/\/(width=\d+|original=true)\//, `/width=${width}/`);
}

function getPreviewUrl(model: CivitModel): string | null {
  for (const v of model.modelVersions) {
    for (const img of v.images) {
      if (img.url && !img.url.toLowerCase().endsWith(".mp4")) {
        return civitThumbnail(img.url);
      }
    }
  }
  return null;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function CivitResultCard({
  model,
  localFiles,
  onClick,
  onSearchCreator,
}: CivitResultCardProps) {
  const preview = getPreviewUrl(model);
  const { data: bookmarks } = useCivitBookmarks();
  const { data: banned } = useCivitBanned();
  const addBookmark = useCivitAddBookmark();
  const removeBookmark = useCivitRemoveBookmark();
  const addBan = useCivitAddBanned();
  const removeBan = useCivitRemoveBanned();

  const isBookmarked = bookmarks?.some((b) => b.name === model.name) ?? false;
  const isBanned = banned?.some((b) => b.name === model.name) ?? false;

  const { downloadedCount, totalFiles } = useMemo(() => {
    let downloaded = 0;
    let total = 0;
    for (const v of model.modelVersions) {
      for (const f of v.files) {
        total++;
        if (f.hashes.SHA256 && localFiles[f.hashes.SHA256]) downloaded++;
      }
    }
    return { downloadedCount: downloaded, totalFiles: total };
  }, [model.modelVersions, localFiles]);
  const hasAll = totalFiles > 0 && downloadedCount === totalFiles;
  const hasSome = downloadedCount > 0 && !hasAll;

  const creatorName = model.creator.username;
  // "Unknown" is the backend's fallback for deleted/anonymous creators, which
  // has no real profile page, so skip the link for it.
  const canLinkCreator = Boolean(creatorName) && creatorName !== "Unknown";
  const creatorUrl = `https://civitai.com/user/${encodeURIComponent(creatorName)}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 w-full px-2 py-1.5 hover:bg-muted/30 cursor-pointer text-left rounded-sm"
    >
      <div className="w-10 h-10 rounded bg-muted/50 overflow-hidden shrink-0 flex items-center justify-center">
        {preview ? (
          <img src={preview} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span className="text-4xs text-muted-foreground">N/A</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium line-clamp-2">{model.name}</div>
        <div className="flex items-center gap-2 text-3xs text-muted-foreground overflow-hidden">
          <Badge variant="outline" className="text-4xs px-1 py-0 shrink-0">
            {model.type}
          </Badge>
          {model.modelVersions[0]?.baseModel && (
            <Badge variant="secondary" className="text-4xs px-1 py-0 shrink-0">
              {model.modelVersions[0].baseModel}
            </Badge>
          )}
          <CivitFlags model={model} compact />
          {canLinkCreator ? (
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSearchCreator(creatorName);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      onSearchCreator(creatorName);
                    }
                  }}
                  className="truncate cursor-pointer hover:text-foreground hover:underline transition-colors"
                  title={`Search ${creatorName}'s models · right-click for more`}
                >
                  {creatorName}
                </span>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-52">
                <ContextMenuItem onClick={() => onSearchCreator(creatorName)}>
                  <Search size={14} /> Search this creator
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => window.open(creatorUrl, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink size={14} /> Open Civitai profile
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={() => {
                    void navigator.clipboard.writeText(creatorName);
                    toast.success("Username copied", { description: creatorName });
                  }}
                >
                  <Copy size={14} /> Copy username
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ) : (
            <span className="truncate">{creatorName}</span>
          )}
          <span className="flex items-center gap-0.5">
            <Download className="h-2.5 w-2.5" />
            {formatCount(model.stats.downloadCount)}
          </span>
          {hasAll && <Check className="h-3 w-3 text-green-500 shrink-0" />}
          {hasSome && <Check className="h-3 w-3 text-yellow-500 shrink-0" />}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            if (isBookmarked) removeBookmark.mutate(model.name);
            else addBookmark.mutate(model.name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation();
              if (isBookmarked) removeBookmark.mutate(model.name);
              else addBookmark.mutate(model.name);
            }
          }}
          className="p-1 rounded hover:bg-muted/50 transition-colors"
          title={isBookmarked ? "Remove bookmark" : "Bookmark"}
        >
          <Bookmark
            className={`h-3 w-3 ${isBookmarked ? "fill-primary text-primary" : "text-muted-foreground"}`}
          />
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            if (isBanned) removeBan.mutate(model.name);
            else addBan.mutate(model.name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation();
              if (isBanned) removeBan.mutate(model.name);
              else addBan.mutate(model.name);
            }
          }}
          className="p-1 rounded hover:bg-muted/50 transition-colors"
          title={isBanned ? "Remove from banned" : "Ban this model"}
        >
          <Ban
            className={`h-3 w-3 ${isBanned ? "fill-orange-500 text-orange-500" : "text-muted-foreground"}`}
          />
        </span>
      </div>
    </button>
  );
}
