// The pictures of a library entry, small: one filling the block, or up to
// four in a grid, with a count of the rest. A server entry's come from the
// server by hash; an older build's entry's from this browser.

import { ImageOff, type LucideIcon } from "lucide-react";
import { blobUrl } from "@/api/blobs";
import { MediaImg } from "@/components/ui/media";
import { useThumb } from "@/inputs/thumbs";
import type { StoredPicture } from "@/lib/inputs/stored";
import { cn } from "@/lib/utils";

/** One small picture: a thumbnail the server holds, or a picture stored here. */
export type ThumbCell =
  | { key: string; kind: "server"; hash: string; lost: boolean }
  | { key: string; kind: "local"; picture: StoredPicture };

const NO_PREVIEW = "No preview";

function Missing({ className, title }: { className?: string | undefined; title: string }) {
  return (
    <span className={cn("grid place-items-center bg-muted/40", className)} title={title}>
      <ImageOff size={14} className="text-muted-foreground" aria-hidden />
    </span>
  );
}

function LocalCell({
  picture,
  active,
  className,
}: {
  picture: StoredPicture;
  active: boolean;
  className?: string | undefined;
}) {
  const url = useThumb(picture.missing ? null : { ...picture, file: null }, active);
  if (picture.missing)
    return <Missing className={className} title="This picture could not be read" />;
  return url ? (
    <img
      src={url}
      alt=""
      draggable={false}
      className={cn("h-full min-h-0 w-full object-cover", className)}
    />
  ) : (
    <span className={cn("bg-muted/40", className)} />
  );
}

function Cell({
  cell,
  active,
  className,
}: {
  cell: ThumbCell;
  active: boolean;
  className?: string | undefined;
}) {
  if (cell.kind === "local")
    return <LocalCell picture={cell.picture} active={active} className={className} />;
  // the thumbnail's bytes are gone: nothing to show, which is not the picture's loss
  const src = cell.lost ? null : blobUrl(cell.hash);
  if (!src) return <Missing className={className} title={NO_PREVIEW} />;
  return active ? (
    <MediaImg
      image={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn("h-full min-h-0 w-full object-cover", className)}
    />
  ) : (
    <span className={cn("bg-muted/40", className)} />
  );
}

interface EntryThumbsProps {
  cells: readonly ThumbCell[];
  more: number;
  /** Load the thumbnails: the block is in or near view. */
  active: boolean;
  /** Shown in place of the pictures, for an entry this build cannot read. */
  note?: string | null;
  /** Drawn when there are no pictures: a recipe saved with no output or inputs. */
  empty?: LucideIcon | null;
}

export function EntryThumbs({
  cells,
  more,
  active,
  note = null,
  empty: Empty = null,
}: EntryThumbsProps) {
  return (
    <div
      className={cn(
        "relative grid aspect-[4/3] w-full gap-px overflow-hidden rounded-t-md bg-border/40",
        cells.length > 1 && "grid-cols-2",
        cells.length > 2 && "grid-rows-2",
      )}
    >
      {note ? (
        <span className="grid place-items-center bg-muted/40 px-2 text-center text-4xs text-muted-foreground">
          {note}
        </span>
      ) : (
        <>
          {cells.length === 0 && (
            <span className="grid place-items-center bg-muted/40">
              {Empty && <Empty size={20} className="text-muted-foreground/60" aria-hidden />}
            </span>
          )}
          {cells.map((cell, i) => (
            <Cell
              key={cell.key}
              cell={cell}
              active={active}
              // three pictures: the first takes the left half
              className={cells.length === 3 && i === 0 ? "row-span-2" : undefined}
            />
          ))}
        </>
      )}
      {more > 0 && !note && (
        <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-4xs tabular-nums text-white">
          +{more}
        </span>
      )}
    </div>
  );
}
