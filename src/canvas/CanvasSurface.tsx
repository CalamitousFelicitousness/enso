import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useDropTarget } from "@/hooks/useDropTarget";
import { useWindowPaste } from "@/hooks/useWindowPaste";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import type { EntryPayload, ImagePayload } from "@/lib/drag";
import { screenToWorld } from "@/lib/viewport/camera";
import { ChromeContext } from "./navigation/chrome";
import type { SurfaceTool } from "@/lib/viewport/gestures";
import type { Camera } from "./navigation/camera";
import { useViewportGestures } from "./navigation/useViewportGestures";

/** A pointer position on the canvas, in container and canvas coordinates. */
export interface SurfacePoint {
  screenX: number;
  screenY: number;
  canvasX: number;
  canvasY: number;
}

interface CanvasSurfaceProps {
  camera: Camera;
  /** Which tool owns the left button; read at event time. Defaults to the move tool. */
  tool?: () => SurfaceTool;
  /** The Konva stage, plus chrome pinned to the container edges. */
  children: ReactNode;
  /** Chrome anchored to canvas coordinates; rides the pan delta. */
  overlay?: ReactNode;
  /** The controls pinned top-right, above the anchored chrome. */
  controls?: ReactNode;
  /** The minimap pinned bottom-right, above the anchored chrome. */
  minimap?: ReactNode;
  /** Chrome below the canvas, outside its clip. */
  below?: ReactNode;
  onDropFiles?: (files: File[], point: SurfacePoint) => void;
  /** What a drop or a paste takes. Defaults to images by MIME. */
  acceptFile?: (file: File) => boolean;
  /** What a drop or a paste takes, in words, for one that holds none of it. */
  acceptKinds?: string;
  onDropImage?: (payload: ImagePayload, point: SurfacePoint) => void;
  /** A library entry; without this the surface refuses entries. */
  onDropEntry?: (payload: EntryPayload, point: SurfacePoint) => void;
  onPasteFiles?: (files: File[]) => void;
  className?: string;
}

const moveTool = (): SurfaceTool => "move";

/**
 * The container contract both canvases share: a clipped positioning context
 * sized to the stage, a drop target, a paste target, and the wrapper that
 * carries canvas-anchored chrome through a gesture.
 */
export function CanvasSurface({
  camera,
  tool = moveTool,
  children,
  overlay,
  controls,
  minimap,
  below,
  onDropFiles,
  onDropImage,
  onDropEntry,
  onPasteFiles,
  acceptFile,
  acceptKinds,
  className,
}: CanvasSurfaceProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);

  // Read off the freshest viewport: a gesture may not have committed yet.
  const pointFrom = useCallback(
    (e: React.DragEvent): SurfacePoint => {
      const rect = e.currentTarget.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const world = screenToWorld(camera.live(), { x: screenX, y: screenY });
      return { screenX, screenY, canvasX: world.x, canvasY: world.y };
    },
    [camera],
  );

  const dropImage = useCallback(
    (payload: ImagePayload, e: React.DragEvent) => onDropImage?.(payload, pointFrom(e)),
    [onDropImage, pointFrom],
  );
  const dropEntry = useCallback(
    (payload: EntryPayload, e: React.DragEvent) => onDropEntry?.(payload, pointFrom(e)),
    [onDropEntry, pointFrom],
  );
  const { isOver, ...dropHandlers } = useDropTarget({
    ...(onDropImage ? { onDropImage: dropImage } : {}),
    ...(onDropEntry ? { onDropEntry: dropEntry } : {}),
    onFilesDrop: useCallback(
      (files: File[], e: React.DragEvent) => onDropFiles?.(files, pointFrom(e)),
      [onDropFiles, pointFrom],
    ),
    ...(acceptFile ? { acceptFile } : {}),
    ...(acceptKinds ? { kinds: acceptKinds } : {}),
  });

  const visible = useKeepAliveVisible();
  useViewportGestures({ surfaceRef: clipRef, camera, tool, enabled: visible });
  useWindowPaste((files) => onPasteFiles?.(files), visible && onPasteFiles !== undefined, {
    accept: acceptFile,
    kinds: acceptKinds,
  });

  // A gesture moves the stage imperatively and only commits on release, so the
  // chrome rides the same delta until the store catches up.
  useEffect(() => {
    return camera.bus.subscribe((vp) => {
      const node = overlayRef.current;
      if (!node) return;
      const base = camera.committed();
      const ratio = vp.scale / base.scale;
      const dx = vp.x - base.x * ratio;
      const dy = vp.y - base.y * ratio;
      node.style.transform = `translate(${dx}px, ${dy}px) scale(${ratio})`;
    });
  }, [camera]);

  // A committed change re-renders the chrome at the new viewport, so the delta
  // has to clear or it double-applies.
  useEffect(() => {
    return camera.subscribe(() => {
      if (overlayRef.current) overlayRef.current.style.transform = "";
    });
  }, [camera]);

  return (
    <ChromeContext.Provider value={camera.chrome}>
      <div className={cn("relative flex h-full w-full flex-col overflow-hidden", className)}>
        {/* Clips the transformed overlay, and is the box every frame header
            measures its anchor against. Gestures bind here; it owns touch and
            selection so a drag pans instead of scrolling or selecting. */}
        <div
          className={cn(
            "relative min-h-0 flex-1 touch-none overflow-hidden select-none",
            isOver && "ring-2 ring-primary ring-inset",
          )}
          ref={clipRef}
          {...dropHandlers}
        >
          {children}
          <div ref={overlayRef} className="pointer-events-none absolute inset-0 origin-top-left">
            {overlay}
          </div>
          {controls}
          {minimap}
        </div>
        {below}
      </div>
    </ChromeContext.Provider>
  );
}
