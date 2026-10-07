// What a frame holds: the layers of a composed frame, or the pictures of a
// set frame in the order they are sent.

import { useCallback, useRef } from "react";
import { Eye, EyeOff, Plus, X } from "lucide-react";
import { SectionLeader } from "@/components/ui/section-leader";
import { Button } from "@/components/ui/button";
import { LayerPanel } from "@/components/generation/LayerPanel";
import { useInputStore } from "@/stores/inputStore";
import { useBlobUrl } from "@/inputs/media";
import { addFilesToInputs } from "@/inputs/route";
import { removePicture } from "@/inputs/edits";
import { INPUTS_FULL_HINT } from "@/inputs/capacity";
import { useInputsAtCapacity } from "@/canvas/useInputsAtCapacity";
import type { OutlineEntry } from "@/lib/inputs/outline";
import { addressLabel, mapStateWord } from "@/lib/inputs/text";
import { isComposed, type Frame, type Picture } from "@/lib/inputs/types";
import { cn } from "@/lib/utils";

function Thumbnail({ picture }: { picture: Picture }) {
  const url = useBlobUrl(picture.file);
  const box = "w-8 h-8 rounded flex-shrink-0";
  return url ? (
    <img src={url} alt={picture.name} className={cn(box, "object-cover")} />
  ) : (
    <div className={cn(box, "bg-muted/40")} />
  );
}

function SetPictures({ frame, entry }: { frame: Frame; entry: OutlineEntry }) {
  const setPictureVisible = useInputStore((s) => s.setPictureVisible);
  const showHiddenBySwitch = useInputStore((s) => s.showHiddenBySwitch);
  const atCapacity = useInputsAtCapacity();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addBlocked = frame.role === "reference" && atCapacity;

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = "";
      if (files.length > 0) void addFilesToInputs(files, frame.id);
    },
    [frame.id],
  );

  const shown = frame.pictures.filter((p) => !p.hiddenBySwitch);
  return (
    <div className="flex flex-col gap-1">
      {shown.length === 0 && (
        <p className="text-3xs text-muted-foreground text-center py-1">No pictures yet</p>
      )}
      {shown.map((picture) => {
        const slot = entry.slots.find((s) => s.pictureId === picture.id);
        const map = entry.sent.find((s) => s.pictureId === picture.id)?.map ?? null;
        const mapWord = map ? mapStateWord(map.state) : "";
        const where = !picture.visible
          ? "hidden, not sent"
          : slot?.address
            ? `${addressLabel(slot.address)}${mapWord ? ` · ${mapWord}` : ""}`
            : "";
        return (
          <div
            key={picture.id}
            className="flex items-center gap-1.5 px-1.5 py-1 rounded border border-transparent"
          >
            <Thumbnail picture={picture} />
            <div className="flex-1 min-w-0">
              <p className="text-3xs truncate" title={picture.name}>
                {picture.name}
              </p>
              <p className="text-4xs text-muted-foreground">
                {picture.file ? where : "could not be read"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setPictureVisible(frame.id, picture.id, !picture.visible)}
              className="text-muted-foreground flex-shrink-0"
              title={picture.visible ? "Hide: not sent" : "Show"}
            >
              {picture.visible ? <Eye size={10} /> : <EyeOff size={10} />}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => removePicture(frame.id, picture.id)}
              className="text-muted-foreground flex-shrink-0"
              title={`Remove ${picture.name}`}
            >
              <X size={10} />
            </Button>
          </div>
        );
      })}
      {entry.hiddenBySwitch > 0 && (
        <button
          type="button"
          onClick={() => showHiddenBySwitch(frame.id)}
          className="text-3xs text-amber-400 hover:text-amber-300 text-left px-1.5"
        >
          {entry.hiddenBySwitch} hidden by the role switch, not sent. Show as pictures.
        </button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={addBlocked}
        className="w-full h-6 text-3xs text-muted-foreground"
        title={addBlocked ? INPUTS_FULL_HINT : "Add pictures to this frame"}
      >
        <Plus size={10} />
        Add picture
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileInput}
        className="hidden"
      />
    </div>
  );
}

export function PicturesSection({ frame, entry }: { frame: Frame; entry: OutlineEntry }) {
  return (
    <SectionLeader title="Pictures" collapsible>
      {isComposed(frame.role) ? (
        <LayerPanel frameId={frame.id} />
      ) : (
        <SetPictures frame={frame} entry={entry} />
      )}
    </SectionLeader>
  );
}
