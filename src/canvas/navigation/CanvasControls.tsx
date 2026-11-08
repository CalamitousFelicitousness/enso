import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown, Fullscreen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SHORTCUTS, formatShortcut } from "@/lib/shortcuts";
import { zoomPercent } from "@/lib/viewport/camera";
import { cn } from "@/lib/utils";
import type { Camera } from "./camera";
import {
  SHOW_ALL,
  SHOW_ALL_HELD,
  ZOOM_100,
  ZOOM_100_TITLE,
  ZOOM_IN,
  ZOOM_OUT,
  percentText,
  zoomLabel,
  zoomToFrame,
} from "./text";

const keyOf = (id: string) => {
  const def = SHORTCUTS[id];
  return def ? formatShortcut(def) : "";
};

const GLASS = "bg-background/80 backdrop-blur-sm";

function useFollowing(camera: Camera) {
  return useSyncExternalStore(camera.subscribeFollow, camera.following);
}

/** Show all frames; pressed while the view keeps showing them. */
function ShowAllButton({ camera }: { camera: Camera }) {
  const held = useFollowing(camera) === "all";
  const title = `${held ? SHOW_ALL_HELD : SHOW_ALL} (${keyOf("canvas-show-all")})`;
  return (
    <Button
      variant="secondary"
      size="icon-xs"
      onClick={() => camera.showAll()}
      aria-pressed={held}
      aria-label={SHOW_ALL}
      title={title}
      className={cn(GLASS, held && "text-primary ring-1 ring-primary/40")}
    >
      <Fullscreen size={12} />
    </Button>
  );
}

/** The zoom readout, written from the camera's frames, and its menu. */
function ZoomMenu({ camera, frameName }: { camera: Camera; frameName?: string | undefined }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const write = () => {
      const percent = zoomPercent(camera.live(), camera.unit());
      if (textRef.current) textRef.current.textContent = percentText(percent);
      triggerRef.current?.setAttribute("aria-label", zoomLabel(percent));
    };
    write();
    return camera.bus.subscribe(write);
  }, [camera]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant="secondary"
          size="xs"
          className={cn(
            GLASS,
            "w-16 justify-between gap-0.5 px-1.5 text-2xs font-mono tabular-nums",
          )}
        >
          <span ref={textRef} />
          <ChevronDown size={10} className="shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem disabled={open && !camera.canZoom(1)} onSelect={() => camera.zoomStep(1)}>
          {ZOOM_IN}
          <DropdownMenuShortcut>{keyOf("canvas-zoom-in")}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={open && !camera.canZoom(-1)}
          onSelect={() => camera.zoomStep(-1)}
        >
          {ZOOM_OUT}
          <DropdownMenuShortcut>{keyOf("canvas-zoom-out")}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem title={ZOOM_100_TITLE} onSelect={() => camera.zoomToUnit()}>
          {ZOOM_100}
          <DropdownMenuShortcut>{keyOf("canvas-zoom-100")}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => camera.showAll()}>
          {SHOW_ALL}
          <DropdownMenuShortcut>{keyOf("canvas-show-all")}</DropdownMenuShortcut>
        </DropdownMenuItem>
        {frameName !== undefined && (
          <DropdownMenuItem onSelect={() => camera.fitFrame()}>
            {zoomToFrame(frameName)}
            <DropdownMenuShortcut>{keyOf("canvas-zoom-frame")}</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface CanvasControlsProps {
  camera: Camera;
  /** The mode pill (Images). */
  mode?: ReactNode;
  /** The current frame's name, for Zoom to it (Images). */
  frameName?: string;
  /** What the canvas holds: add, clear. */
  children?: ReactNode;
  /** The tutorial step that points here. */
  tour?: string;
}

/** The top-right cluster: how the canvas is viewed, then what it holds. */
export function CanvasControls({ camera, mode, frameName, children, tour }: CanvasControlsProps) {
  return (
    <div
      className="absolute top-2 right-2 flex items-center gap-3"
      data-key-surface="canvas"
      data-tour={tour}
    >
      <div className="flex items-center gap-1.5">
        {mode}
        <ShowAllButton camera={camera} />
        <ZoomMenu camera={camera} frameName={frameName} />
      </div>
      {children && <div className="flex items-center gap-1.5">{children}</div>}
    </div>
  );
}
