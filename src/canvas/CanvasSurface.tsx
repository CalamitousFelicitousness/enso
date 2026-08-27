import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useDropTarget } from "@/hooks/useDropTarget";
import { useWindowPaste } from "@/hooks/useWindowPaste";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import type { DragPayload } from "@/stores/dragStore";
import type { ViewportAdapter } from "./viewportAdapter";

/** A pointer position on the canvas, in container and canvas coordinates. */
export interface SurfacePoint {
  screenX: number;
  screenY: number;
  canvasX: number;
  canvasY: number;
}

interface CanvasSurfaceProps {
  viewport: ViewportAdapter;
  /** The Konva stage, plus chrome pinned to the container edges. */
  children: ReactNode;
  /** Chrome anchored to canvas coordinates; rides the pan delta. */
  overlay?: ReactNode;
  /** Chrome below the canvas, outside its clip. */
  below?: ReactNode;
  onDropFiles?: (files: File[], point: SurfacePoint) => void;
  onDropPayload?: (payload: DragPayload, point: SurfacePoint) => void;
  onPasteFiles?: (files: File[]) => void;
  className?: string;
}

/**
 * The container contract both canvases share: a clipped positioning context
 * sized to the stage, a drop target, a paste target, and the wrapper that
 * carries canvas-anchored chrome through a gesture.
 */
export function CanvasSurface({
  viewport,
  children,
  overlay,
  below,
  onDropFiles,
  onDropPayload,
  onPasteFiles,
  className,
}: CanvasSurfaceProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Read off the freshest viewport: a gesture may not have committed yet.
  const pointFrom = useCallback(
    (e: React.DragEvent): SurfacePoint => {
      const rect = e.currentTarget.getBoundingClientRect();
      const vp = viewport.getViewport();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      return {
        screenX,
        screenY,
        canvasX: (screenX - vp.x) / vp.scale,
        canvasY: (screenY - vp.y) / vp.scale,
      };
    },
    [viewport],
  );

  const { isOver, ...dropHandlers } = useDropTarget({
    onDropPayload: useCallback(
      (payload: DragPayload, e: React.DragEvent) => onDropPayload?.(payload, pointFrom(e)),
      [onDropPayload, pointFrom],
    ),
    onFileDrop: useCallback(
      (file: File, e: React.DragEvent) => onDropFiles?.([file], pointFrom(e)),
      [onDropFiles, pointFrom],
    ),
  });

  const visible = useKeepAliveVisible();
  useWindowPaste((files) => onPasteFiles?.(files), visible && onPasteFiles !== undefined);

  // A gesture moves the stage imperatively and only commits on release, so the
  // chrome rides the same delta until the store catches up.
  useEffect(() => {
    return viewport.bus.subscribe((vp) => {
      const node = overlayRef.current;
      if (!node) return;
      const base = viewport.getCommitted();
      const ratio = vp.scale / base.scale;
      const dx = vp.x - base.x * ratio;
      const dy = vp.y - base.y * ratio;
      node.style.transform = `translate(${dx}px, ${dy}px) scale(${ratio})`;
    });
  }, [viewport]);

  // A committed change re-renders the chrome at the new viewport, so the delta
  // has to clear or it double-applies.
  useEffect(() => {
    return viewport.subscribe(() => {
      if (overlayRef.current) overlayRef.current.style.transform = "";
    });
  }, [viewport]);

  return (
    <div className={cn("relative flex h-full w-full flex-col overflow-hidden", className)}>
      {/* Clips the transformed overlay, and is the box every frame header
          measures its anchor against. */}
      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden",
          isOver && "ring-2 ring-primary ring-inset",
        )}
        {...dropHandlers}
      >
        {children}
        <div ref={overlayRef} className="pointer-events-none absolute inset-0 origin-top-left">
          {overlay}
        </div>
      </div>
      {below}
    </div>
  );
}
