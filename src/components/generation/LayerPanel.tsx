import { useCallback, useRef } from "react";
import { useInputStore } from "@/stores/inputStore";
import { useGenerationStore } from "@/stores/generationStore";
import { addFilesToInputs } from "@/inputs/route";
import { removePicture } from "@/inputs/edits";
import { useBlobUrl } from "@/inputs/media";
import type { MaskObject, Picture } from "@/lib/inputs/types";
import { Eye, EyeOff, X, Plus, Frame, Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function LayerDims({ layer }: { layer: Picture }) {
  const scaleX = layer.transform?.scaleX ?? 1;
  const scaleY = layer.transform?.scaleY ?? 1;
  const canvasW = Math.round(Math.abs(layer.width * scaleX));
  const canvasH = Math.round(Math.abs(layer.height * scaleY));
  const isTransformed = canvasW !== layer.width || canvasH !== layer.height;
  return (
    <p className="text-4xs text-muted-foreground" title={`Native: ${layer.width}×${layer.height}`}>
      {isTransformed ? (
        <>
          {canvasW}&times;{canvasH}{" "}
          <span className="opacity-50">
            ({layer.width}&times;{layer.height})
          </span>
        </>
      ) : (
        <>
          {layer.width}&times;{layer.height}
        </>
      )}
    </p>
  );
}

function Thumbnail({
  blob,
  name,
  className,
}: {
  blob: Blob | null;
  name: string;
  className?: string;
}) {
  const url = useBlobUrl(blob);
  const box = cn("w-8 h-8 rounded flex-shrink-0", className);
  return url ? (
    <img src={url} alt={name} className={cn(box, "object-cover")} />
  ) : (
    <div className={cn(box, "bg-muted/40")} />
  );
}

const ROW =
  "flex items-center gap-1.5 px-1.5 py-1 rounded cursor-pointer transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]";
const ROW_ACTIVE = "bg-primary/15 border border-primary/30";
const ROW_IDLE = "hover:bg-muted/60 border border-transparent";

interface LayerPanelProps {
  /** Frame to list; defaults to the selected Input frame. */
  frameId?: string | undefined;
}

export function LayerPanel({ frameId }: LayerPanelProps = {}) {
  const frame = useInputStore((s) => {
    const wanted = frameId ?? s.selectedFrameId;
    return s.frames.find((f) => f.id === wanted) ?? s.frames[0] ?? null;
  });
  const activeItem = useInputStore((s) => s.activeItem);
  const setActiveItem = useInputStore((s) => s.setActiveItem);
  const setPictureVisible = useInputStore((s) => s.setPictureVisible);
  const patchTransform = useInputStore((s) => s.patchTransform);
  const patchMaskObject = useInputStore((s) => s.patchMaskObject);
  const removeItem = useInputStore((s) => s.removeItem);
  const setParam = useGenerationStore((s) => s.setParam);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // What a role switch hid belongs to the frame's other role; its header says so
  const layers = frame?.pictures.filter((p) => !p.hiddenBySwitch) ?? [];
  const masks = frame?.mask.objects ?? [];
  const activeId = frame && activeItem?.frameId === frame.id ? activeItem.id : null;

  const select = (id: string) => {
    if (frame) setActiveItem({ frameId: frame.id, id });
  };

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = "";
      if (files.length > 0 && frame) void addFilesToInputs(files, frame.id);
    },
    [frame],
  );

  const openPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const fitFrameTo = (layer: Picture) => {
    if (!frame || !layer.transform) return;
    const { scaleX, scaleY } = layer.transform;
    const w = Math.max(64, Math.round(Math.abs(layer.width * scaleX) / 8) * 8);
    const h = Math.max(64, Math.round(Math.abs(layer.height * scaleY) / 8) * 8);
    setParam("width", w);
    setParam("height", h);
    patchTransform(frame.id, layer.id, {
      x: (w - layer.width * scaleX) / 2,
      y: (h - layer.height * scaleY) / 2,
    });
  };

  return (
    <div className="flex flex-col gap-1">
      {layers.length === 0 && (
        <p className="text-3xs text-muted-foreground text-center py-1">Drop images onto canvas</p>
      )}

      {layers.map((layer) => {
        const isActive = layer.id === activeId;
        const truncName = layer.name.length > 18 ? `${layer.name.slice(0, 15)}...` : layer.name;
        return (
          <div
            key={layer.id}
            role="button"
            tabIndex={0}
            aria-label={`Select layer ${layer.name}`}
            aria-pressed={isActive}
            className={cn(ROW, isActive ? ROW_ACTIVE : ROW_IDLE)}
            onClick={() => select(layer.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                select(layer.id);
              }
            }}
          >
            <Thumbnail blob={layer.file} name={layer.name} />

            {/* Name + dims */}
            <div className="flex-1 min-w-0">
              <p className="text-3xs truncate" title={layer.name}>
                {truncName}
              </p>
              {layer.file ? (
                <LayerDims layer={layer} />
              ) : (
                <p className="text-4xs text-destructive">could not be read</p>
              )}
            </div>
            {/* Fit frame to image */}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                fitFrameTo(layer);
              }}
              disabled={!layer.transform}
              className="text-muted-foreground flex-shrink-0"
              title="Fit frame to this layer and center it (snapped to 8px grid)"
            >
              <Frame size={10} />
            </Button>
            {/* Visibility toggle */}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                if (frame) setPictureVisible(frame.id, layer.id, !layer.visible);
              }}
              className="text-muted-foreground flex-shrink-0"
              title={
                layer.visible
                  ? "Hide layer - hidden layers are excluded from the composite sent to the backend"
                  : "Show layer"
              }
            >
              {layer.visible ? <Eye size={10} /> : <EyeOff size={10} />}
            </Button>
            {/* Delete */}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                if (frame) removePicture(frame.id, layer.id);
              }}
              className="text-muted-foreground flex-shrink-0"
              title="Remove layer"
            >
              <X size={10} />
            </Button>
          </div>
        );
      })}

      {/* Mask objects */}
      {masks.length > 0 && (
        <>
          <p className="text-2xs text-muted-foreground uppercase tracking-wider px-1 pt-1">Masks</p>
          {masks.map((mask: MaskObject) => {
            const isActive = mask.id === activeId;
            return (
              <div
                key={mask.id}
                role="button"
                tabIndex={0}
                aria-label={`Select mask ${mask.name}`}
                aria-pressed={isActive}
                className={cn(ROW, isActive ? ROW_ACTIVE : ROW_IDLE)}
                onClick={() => select(mask.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(mask.id);
                  }
                }}
              >
                <Thumbnail blob={mask.blob} name={mask.name} className="bg-black/20" />

                <div className="flex-1 min-w-0">
                  <p className="text-3xs truncate" title={mask.name}>
                    {mask.name}
                  </p>
                  <p className="text-4xs text-muted-foreground">
                    {mask.width}&times;{mask.height}
                  </p>
                </div>
                {/* Lock toggle */}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (frame) patchMaskObject(frame.id, mask.id, { locked: !mask.locked });
                  }}
                  className="text-muted-foreground flex-shrink-0"
                  title={
                    mask.locked
                      ? "Unlock mask - allows moving and resizing"
                      : "Lock mask - prevents accidental interaction"
                  }
                >
                  {mask.locked ? <Lock size={10} /> : <Unlock size={10} />}
                </Button>
                {/* Visibility toggle */}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (frame) patchMaskObject(frame.id, mask.id, { visible: !mask.visible });
                  }}
                  className="text-muted-foreground flex-shrink-0"
                  title={mask.visible ? "Hide mask" : "Show mask"}
                >
                  {mask.visible ? <Eye size={10} /> : <EyeOff size={10} />}
                </Button>
                {/* Delete */}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (frame) removeItem(frame.id, mask.id);
                  }}
                  className="text-muted-foreground flex-shrink-0"
                  title="Remove mask"
                >
                  <X size={10} />
                </Button>
              </div>
            );
          })}
        </>
      )}

      {/* Add image button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={openPicker}
        className="w-full h-6 text-3xs text-muted-foreground"
        title="Add an image layer to the canvas. You can also drag and drop files directly onto the canvas."
      >
        <Plus size={10} />
        Add Image
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
