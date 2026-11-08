import {
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { FrameId } from "@/lib/inputs/frames";
import { visibleWorld } from "@/lib/viewport/camera";
import { unionBoxes, type ScreenChrome } from "@/lib/viewport/insets";
import {
  dragView,
  drawnRect,
  minimapBounds,
  minimapProjection,
  minimapRoom,
  minimapSize,
  projectBox,
  unproject,
  viewportRect,
  type Projection,
} from "@/lib/viewport/minimap";
import type { MinimapFrame } from "@/lib/viewport/scenes";
import type { Point, Size } from "@/lib/viewport/types";
import { cn } from "@/lib/utils";
import type { Camera } from "./camera";
import { ChromeContext, measureScreenChrome, useChromeBoxes } from "./chrome";
import { MINIMAP_HINT, MINIMAP_LABEL, focusLabel } from "./text";

const KEY = "minimap";
/** Map units per rem: the map scales with the interface. */
const UNITS_PER_REM = 16;
const LABEL_SIZE = 9;
/** Half the rectangle's stroke, so it shows whole at the map's edge. */
const RECT_INSET = 0.5;
/** A frame narrower than this on the map drops its number. */
const LABEL_MIN_WIDTH = 14;
/** CSS pixels a press moves before it drags. */
const SLOP = { mouse: 4, pen: 4, touch: 10 } as const;

interface MinimapProps {
  camera: Camera;
  frames: MinimapFrame[];
  /** The setting; off, the map stays measured but hidden. */
  on: boolean;
  /** A double-click or Enter on a frame. */
  onFocus: (id: FrameId) => void;
  /** Whether the canvas is wide enough for the map. */
  onRoom: (room: boolean) => void;
}

function sameSize(a: Size | null, b: Size | null): boolean {
  return a === b || (a !== null && b !== null && a.width === b.width && a.height === b.height);
}

/**
 * Every frame as a labelled box, with the view's rectangle drawn from the
 * camera's frames. A drag moves the view, a click centres it, a double-click
 * or Enter on a frame focuses it; the wheel goes to the canvas.
 */
export const Minimap = memo(function Minimap({
  camera,
  frames,
  on,
  onFocus,
  onRoom,
}: MinimapProps) {
  const registry = useContext(ChromeContext);
  const chrome = useChromeBoxes(camera.chrome);
  const committed = useSyncExternalStore(camera.subscribe, camera.committed);
  const [container, setContainer] = useState<Size | null>(camera.container);
  const [extent, setExtent] = useState<ScreenChrome | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rectRef = useRef<SVGRectElement>(null);

  const room =
    extent === null || container === null || minimapRoom(container.width, chrome, extent.width);
  const shown = on && room;

  // The map covers the frames and the committed view's middle; between
  // commits the rectangle is held at the map's edge
  const content = useMemo(() => unionBoxes(frames.map((f) => f.box)), [frames]);
  const bounds = useMemo(
    () => (container ? minimapBounds(content, visibleWorld(committed, container)) : content),
    [content, committed, container],
  );
  const box = useMemo(() => minimapSize(bounds ?? { width: 0, height: 0 }), [bounds]);
  const projection = useMemo(() => (bounds ? minimapProjection(bounds, box) : null), [bounds, box]);
  const placed = useMemo(
    () =>
      projection ? frames.map((frame) => ({ frame, at: projectBox(projection, frame.box) })) : [],
    [frames, projection],
  );

  // Read by the native handlers and the camera's frames
  const live = useRef({ projection, box, shown });
  live.current = { projection, box, shown };

  const drawRect = useRef(() => {});
  drawRect.current = () => {
    const rect = rectRef.current;
    const size = camera.container();
    const p = live.current.projection;
    if (!rect || !size || !p || !live.current.shown) return;
    const r = drawnRect(viewportRect(camera.live(), size, p), live.current.box, RECT_INSET);
    rect.setAttribute("x", String(r.x));
    rect.setAttribute("y", String(r.y));
    rect.setAttribute("width", String(r.width));
    rect.setAttribute("height", String(r.height));
  };
  useLayoutEffect(() => drawRect.current(), [projection, shown]);
  useEffect(
    () =>
      camera.bus.subscribe((_vp, size) => {
        if (size.width > 0 && size.height > 0) {
          setContainer((prev) => (sameSize(prev, size) ? prev : { ...size }));
        }
        drawRect.current();
      }),
    [camera],
  );

  // Measured whether shown or not, so the room rule knows its width
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const next = measureScreenChrome(el, "corner", true);
      if (next) {
        setExtent((prev) =>
          prev && prev.width === next.width && prev.height === next.height ? prev : next,
        );
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!registry) return;
    if (shown && extent) registry.set(KEY, extent);
    else registry.delete(KEY);
  }, [registry, shown, extent]);
  useEffect(() => () => registry?.delete(KEY), [registry]);

  useEffect(() => onRoom(room), [onRoom, room]);

  // Native, so the surface's own pointer handling never sees these
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let press: {
      id: number;
      slop: number;
      client: Point;
      from: Point;
      p: Projection;
      start: ReturnType<Camera["live"]> | null;
    } | null = null;

    const toMap = (e: PointerEvent): Point => {
      const r = svg.getBoundingClientRect();
      const { box: size } = live.current;
      return {
        x: ((e.clientX - r.left) * size.width) / r.width,
        y: ((e.clientY - r.top) * size.height) / r.height,
      };
    };
    const end = (e: PointerEvent) => {
      if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
      svg.style.cursor = "";
      press = null;
    };

    const onDown = (e: PointerEvent) => {
      e.stopPropagation();
      const p = live.current.projection;
      if (press || !p || (e.pointerType === "mouse" && e.button !== 0)) return;
      const kind = e.pointerType === "touch" ? "touch" : e.pointerType === "pen" ? "pen" : "mouse";
      press = {
        id: e.pointerId,
        slop: SLOP[kind],
        client: { x: e.clientX, y: e.clientY },
        from: toMap(e),
        p,
        start: null,
      };
      svg.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      e.stopPropagation();
      if (!press || e.pointerId !== press.id) return;
      if (!press.start) {
        const moved = Math.hypot(e.clientX - press.client.x, e.clientY - press.client.y);
        if (moved < press.slop) return;
        camera.onGesture();
        press.start = camera.live();
        svg.style.cursor = "grabbing";
      }
      camera.apply(dragView(press.start, press.p, press.from, toMap(e)));
    };
    const onUp = (e: PointerEvent) => {
      e.stopPropagation();
      if (!press || e.pointerId !== press.id) return;
      const done = press;
      end(e);
      if (done.start) camera.commit();
      else camera.centerAt(unproject(done.p, toMap(e)));
    };
    const onCancel = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return;
      const dragged = press.start !== null;
      end(e);
      if (dragged) camera.commit();
    };

    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onCancel);
    svg.addEventListener("lostpointercapture", onCancel);
    return () => {
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onCancel);
      svg.removeEventListener("lostpointercapture", onCancel);
    };
  }, [camera]);

  // One tab stop; the arrows move between frames, Enter focuses one
  const [picked, setPicked] = useState<FrameId | null>(null);
  const [ring, setRing] = useState<FrameId | null>(null);
  const active =
    frames.find((f) => f.id === picked)?.id ??
    frames.find((f) => f.current)?.id ??
    frames[0]?.id ??
    null;

  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (!active || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key === "Enter") {
      e.preventDefault();
      onFocus(active);
      return;
    }
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    // The canvas's own arrows step the current frame; inside the map they move focus
    e.preventDefault();
    const index = frames.findIndex((f) => f.id === active);
    const next = frames[Math.min(frames.length - 1, Math.max(0, index + step))];
    if (!next) return;
    setPicked(next.id);
    svgRef.current?.querySelector<SVGGElement>(`[data-frame="${next.id}"]`)?.focus();
  };

  // The press captured the pointer, so the click lands on the svg: find the frame by position
  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) * box.width) / r.width;
    const y = ((e.clientY - r.top) * box.height) / r.height;
    const hit = [...placed]
      .reverse()
      .find(({ at }) => x >= at.x && x <= at.x + at.width && y >= at.y && y <= at.y + at.height);
    if (hit) onFocus(hit.frame.id);
  };

  const ringAt = placed.find(({ frame }) => frame.id === ring)?.at;

  return (
    <div
      ref={wrapRef}
      className={cn(
        "absolute right-3 bottom-3 overflow-hidden rounded-md border border-border/50 bg-popover/70 shadow-lg ring-1 ring-black/[0.05] backdrop-blur-xl shadow-black/30 dark:bg-popover/80 dark:ring-white/[0.05]",
        !shown && "invisible",
      )}
    >
      <svg
        ref={svgRef}
        data-minimap=""
        data-key-surface="canvas"
        role="group"
        aria-label={MINIMAP_LABEL}
        viewBox={`0 0 ${box.width} ${box.height}`}
        style={{
          width: `${box.width / UNITS_PER_REM}rem`,
          height: `${box.height / UNITS_PER_REM}rem`,
        }}
        className="block text-foreground select-none"
        onKeyDown={onKeyDown}
        onDoubleClick={onDoubleClick}
      >
        <title>{MINIMAP_HINT}</title>
        {placed.map(({ frame, at }) => (
          <g
            key={frame.id}
            data-frame={frame.id}
            role="button"
            tabIndex={frame.id === active ? 0 : -1}
            aria-label={focusLabel(frame.name)}
            aria-current={frame.current || undefined}
            className="outline-none"
            onFocus={(e) => {
              setPicked(frame.id);
              setRing(e.currentTarget.matches(":focus-visible") ? frame.id : null);
            }}
            onBlur={() => setRing(null)}
          >
            <title>{frame.name}</title>
            <rect
              x={at.x}
              y={at.y}
              width={at.width}
              height={at.height}
              fill={frame.color}
              fillOpacity={0.25}
              stroke={frame.color}
              strokeOpacity={frame.current ? 1 : 0.7}
              strokeWidth={frame.current ? 1.5 : 1}
              strokeDasharray={frame.off ? "3 2" : undefined}
            />
            {at.width >= LABEL_MIN_WIDTH && (
              <text
                x={at.x + at.width / 2}
                y={at.y + at.height / 2}
                fontSize={LABEL_SIZE}
                fontFamily="IBM Plex Sans"
                textAnchor="middle"
                dominantBaseline="central"
                fill="currentColor"
                pointerEvents="none"
              >
                {frame.short}
              </text>
            )}
          </g>
        ))}
        <rect
          ref={rectRef}
          fill="currentColor"
          fillOpacity={0.06}
          stroke="currentColor"
          strokeOpacity={0.8}
          strokeWidth={1}
          pointerEvents="none"
        />
        {ringAt && (
          <rect
            x={ringAt.x - 2}
            y={ringAt.y - 2}
            width={ringAt.width + 4}
            height={ringAt.height + 4}
            rx={2}
            fill="none"
            className="stroke-ring"
            strokeWidth={1.5}
            pointerEvents="none"
          />
        )}
      </svg>
    </div>
  );
});
