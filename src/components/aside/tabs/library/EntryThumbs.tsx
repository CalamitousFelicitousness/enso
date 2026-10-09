// The pictures of a library entry, small: one filling the block, or up to
// four in a grid, with a count of the rest.

import { ImageOff } from "lucide-react";
import { useThumb } from "@/inputs/thumbs";
import type { StoredPicture } from "@/lib/inputs/stored";
import { cn } from "@/lib/utils";

function Cell({
  picture,
  active,
  className,
}: {
  picture: StoredPicture;
  active: boolean;
  className?: string | undefined;
}) {
  const url = useThumb(picture.missing ? null : { ...picture, file: null }, active);
  if (picture.missing) {
    return (
      <span
        className={cn("grid place-items-center bg-muted/40", className)}
        title="This picture could not be read"
      >
        <ImageOff size={14} className="text-muted-foreground" />
      </span>
    );
  }
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

interface EntryThumbsProps {
  pictures: StoredPicture[];
  more: number;
  /** Make the thumbnails: the block is in or near view. */
  active: boolean;
}

export function EntryThumbs({ pictures, more, active }: EntryThumbsProps) {
  return (
    <div
      className={cn(
        "relative grid aspect-[4/3] w-full gap-px overflow-hidden rounded-t-md bg-border/40",
        pictures.length > 1 && "grid-cols-2",
        pictures.length > 2 && "grid-rows-2",
      )}
    >
      {pictures.length === 0 && <span className="bg-muted/40" />}
      {pictures.map((picture, i) => (
        <Cell
          key={picture.id}
          picture={picture}
          active={active}
          // three pictures: the first takes the left half
          className={pictures.length === 3 && i === 0 ? "row-span-2" : undefined}
        />
      ))}
      {more > 0 && (
        <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-4xs tabular-nums text-white">
          +{more}
        </span>
      )}
    </div>
  );
}
