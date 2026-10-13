import { ImageOff, Trash2, Undo2 } from "lucide-react";
import { ContextMenuSeparator } from "@/components/ui/context-menu";
import { SlotMenuItem } from "@/components/ui/slot-row";
import {
  restoreTrashed,
  showInGalleryTrash,
  useOutputFileState,
} from "@/api/hooks/useGalleryTrash";
import {
  fileStateLabel,
  fileStateText,
  fileTrashReason,
  RESTORE_FILE,
  SHOW_IN_GALLERY_TRASH,
} from "@/lib/gallery/text";
import type { OutputFileState } from "@/lib/gallery/trash";

// The narrowest tile that holds the words on one line, clear of the cover's badges
const WORDS_FROM = 72;

/** A result whose file left its folder: the picture dimmed under the trash glyph,
 * or a crossed picture once the file is deleted for good, and a word where the tile
 * has room for it. `id` names the full words for the tile's `aria-describedby`,
 * which reads them even where they are not shown. */
export function OutputTrashMark({
  state,
  id,
  size,
}: {
  state: OutputFileState;
  id: string;
  size: number;
}) {
  const text = fileStateText(state);
  if (state === null || text === null) return null;
  const Glyph = state.state === "trashed" ? Trash2 : ImageOff;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-white/90"
    >
      <Glyph className={size < 48 ? "size-3" : "size-4"} />
      {size >= WORDS_FROM && (
        <span className="px-0.5 text-center text-3xs leading-none">{fileStateLabel(state)}</span>
      )}
      <span id={id} className="sr-only">
        {text}
      </span>
    </div>
  );
}

/** The menu group for a result's file in the trash: bring it back, or see it
 * in the Gallery. Mounted with the open menu, so it reads the state then. */
export function TrashedFileItems({ url, className }: { url: string; className?: string }) {
  const state = useOutputFileState(url);
  const reason = fileTrashReason(state);
  const size = className === undefined ? {} : { className };
  return (
    <>
      <ContextMenuSeparator />
      <SlotMenuItem
        icon={Undo2}
        label={RESTORE_FILE}
        reason={reason}
        {...size}
        onAct={() => {
          if (state?.state === "trashed") void restoreTrashed([state.item]);
        }}
      />
      <SlotMenuItem
        icon={Trash2}
        label={SHOW_IN_GALLERY_TRASH}
        reason={reason}
        {...size}
        onAct={showInGalleryTrash}
      />
    </>
  );
}
