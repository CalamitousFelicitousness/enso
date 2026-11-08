import { useCallback, useMemo, useRef, useState } from "react";
import { useShortcut } from "@/hooks/useShortcut";
import { FITTED, pictureScaleTo, pictureWheel, type PictureView } from "@/lib/viewport/picture";
import type { Size } from "@/lib/viewport/types";

interface UseImageZoomPanOptions {
  minScale?: number;
  maxScale?: number;
}

interface UseImageZoomPanReturn {
  scale: number;
  translate: { x: number; y: number };
  isDragging: boolean;
  /** Zoom about the middle of the container. */
  setScale: (fn: number | ((s: number) => number)) => void;
  /** The picture fitted to the container. */
  resetTransform: () => void;
  /** The picture centred at one picture pixel per CSS pixel, measured on the
   * first picture in the bound element. */
  zoomToPixels: () => void;
  /** The ref for each element the picture is centred in: the wheel zooms
   * about the pointer there, and a pinch never reaches the page. */
  bind: (el: HTMLElement | null) => (() => void) | undefined;
  handlers: {
    onMouseDown: (e: React.MouseEvent) => void;
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseUp: () => void;
    onMouseLeave: () => void;
  };
  style: React.CSSProperties;
}

export type { UseImageZoomPanReturn };

const KEY_STEP = 1.25;

function sizeOf(el: HTMLElement | undefined): Size {
  const rect = el?.getBoundingClientRect();
  return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
}

export function useImageZoomPan(options: UseImageZoomPanOptions = {}): UseImageZoomPanReturn {
  const { minScale = 0.25, maxScale = 8 } = options;
  const range = useMemo(() => ({ min: minScale, max: maxScale }), [minScale, maxScale]);

  const [view, setView] = useState<PictureView>(FITTED);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const elements = useRef(new Set<HTMLElement>());

  const bind = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return undefined;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const container = { width: rect.width, height: rect.height };
        setView((v) => pictureWheel(v, e, anchor, container, range) ?? v);
      };
      elements.current.add(el);
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => {
        el.removeEventListener("wheel", onWheel);
        elements.current.delete(el);
      };
    },
    [range],
  );

  const scaleAboutCentre = useCallback(
    (target: (current: number) => number) => {
      const container = sizeOf(elements.current.values().next().value);
      const centre = { x: container.width / 2, y: container.height / 2 };
      setView((v) => pictureScaleTo(v, centre, container, target(v.scale), range));
    },
    [range],
  );

  const setScale = useCallback(
    (fn: number | ((s: number) => number)) =>
      scaleAboutCentre((s) => (typeof fn === "function" ? fn(s) : fn)),
    [scaleAboutCentre],
  );

  const resetTransform = useCallback(() => setView(FITTED), []);

  const zoomToPixels = useCallback(() => {
    const el = elements.current.values().next().value;
    const img = el?.querySelector("img");
    if (!img || img.offsetWidth === 0 || img.naturalWidth === 0) return;
    const container = sizeOf(el);
    const centre = { x: container.width / 2, y: container.height / 2 };
    setView(pictureScaleTo(FITTED, centre, container, img.naturalWidth / img.offsetWidth, range));
  }, [range]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (view.scale <= 1) return;
      setIsDragging(true);
      dragStart.current = { x: e.clientX - view.x, y: e.clientY - view.y };
    },
    [view],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const x = e.clientX - dragStart.current.x;
      const y = e.clientY - dragStart.current.y;
      setView((v) => ({ ...v, x, y }));
    },
    [isDragging],
  );

  const onMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const style: React.CSSProperties = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    cursor: view.scale > 1 ? (isDragging ? "grabbing" : "grab") : "default",
  };

  return {
    scale: view.scale,
    translate: { x: view.x, y: view.y },
    isDragging,
    setScale,
    resetTransform,
    zoomToPixels,
    bind,
    handlers: { onMouseDown, onMouseMove, onMouseUp, onMouseLeave: onMouseUp },
    style,
  };
}

/** The zoom keys of a picture view: in, out, fit and the picture's own pixels. */
export function usePictureZoomKeys(
  scope: "lightbox" | "comparison",
  zoom: UseImageZoomPanReturn,
  enabled = true,
) {
  const zoomIn = () => zoom.setScale((s) => s * KEY_STEP);
  useShortcut(`${scope}-zoom-in`, zoomIn, enabled);
  useShortcut(`${scope}-zoom-in-eq`, zoomIn, enabled);
  useShortcut(`${scope}-zoom-out`, () => zoom.setScale((s) => s / KEY_STEP), enabled);
  useShortcut(`${scope}-zoom-reset`, zoom.resetTransform, enabled);
  useShortcut(`${scope}-zoom-fit`, zoom.resetTransform, enabled);
  useShortcut(`${scope}-zoom-100`, zoom.zoomToPixels, enabled);
}
