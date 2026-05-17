import { memo } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One slot in the Reference filmstrip. DOM overlay positioned over a Konva
 * layer that renders the image pixels in canvas coordinates; this component
 * owns the chrome (border, corner brackets, header, drop-replace overlay).
 *
 * Sized in display pixels by the parent (filmstrip container handles the
 * canvas-to-screen projection). The transparent body lets the Konva image
 * underneath show through.
 *
 * State machine (driven by the `state` prop):
 * - `default`: reference-color border, brackets visible, no overlay
 * - `drop-target`: brighter border + glow + replace overlay (file being dragged over)
 * - `dragging`: lifted (translate + rotate + shadow + reduced opacity) while
 *   the user is reordering. Pointer events typically suppressed by the parent.
 */
export interface ReferenceSlotProps {
  /** 1-based wire-order position shown in the badge. */
  index: number;
  /** Filename displayed in the header. Ellipsis on overflow. */
  filename: string;
  /** Slot width in display pixels (image aspect drives this). */
  width: number;
  /** Slot height in display pixels (uniform across slots in a row). */
  height: number;
  state?: "default" | "drop-target" | "dragging";
  onRemove?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  /** Force-show the remove button (e.g. keyboard focus). Default reveals on hover. */
  showRemove?: boolean;
}

export const ReferenceSlot = memo(function ReferenceSlot({
  index,
  filename,
  width,
  height,
  state = "default",
  onRemove,
  onPointerDown,
  showRemove = false,
}: ReferenceSlotProps) {
  const isDragging = state === "dragging";
  const isDropTarget = state === "drop-target";

  return (
    <div
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the slot is a keyboard-focusable affordance for reorder + delete shortcuts
      tabIndex={0}
      role="group"
      aria-label={`Reference image ${index}: ${filename}`}
      data-state={state}
      onPointerDown={onPointerDown}
      style={{
        width,
        height,
        borderColor: isDropTarget ? "var(--reference-drop)" : "var(--reference)",
        boxShadow: isDropTarget
          ? "0 0 0 1px var(--reference-drop), var(--reference-glow)"
          : isDragging
            ? "0 24px 60px -8px rgba(0, 0, 0, 0.6), var(--reference-glow)"
            : undefined,
        opacity: isDragging ? 0.92 : 1,
        transform: isDragging ? "translateY(-12px) rotate(-1.4deg)" : undefined,
        zIndex: isDragging ? 5 : undefined,
      }}
      className={cn(
        "group relative flex shrink-0 flex-col border bg-card",
        "transition-[border-color,box-shadow,transform,opacity]",
        "duration-180 ease-out",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--reference-drop)]",
      )}
    >
      {/* Header: index badge + filename + remove */}
      <div
        className="flex h-6 shrink-0 items-center gap-1.5 border-b px-1 pl-1"
        style={{
          backgroundColor: "oklch(from var(--card) l c h / 0.85)",
          borderBottomColor: isDropTarget
            ? "var(--reference-drop)"
            : "oklch(from var(--reference) l c h / 0.45)",
        }}
      >
        <span
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-[2px] border px-1 font-mono text-3xs font-medium leading-none tabular-nums"
          style={{
            color: "var(--reference)",
            backgroundColor: "oklch(from var(--reference) l c h / 0.12)",
            borderColor: "oklch(from var(--reference) l c h / 0.4)",
          }}
        >
          {index}
        </span>
        <span
          className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-3xs lowercase text-muted-foreground"
          title={filename}
        >
          {filename}
        </span>
        {onRemove && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Remove reference ${index}`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className={cn(
              "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] transition-opacity duration-120",
              "hover:bg-destructive/10 hover:text-destructive",
              showRemove
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            )}
            style={{ color: "oklch(from var(--muted-foreground) l c h / 0.7)" }}
          >
            <X size={10} strokeWidth={2.25} />
          </button>
        )}
      </div>

      {/* Image area - Konva layer underneath renders the actual pixels. */}
      <div className="relative flex-1 overflow-hidden" style={{ backgroundColor: "transparent" }} />

      {/* Drop-replace overlay - shown when a file is being dragged over this slot. */}
      {isDropTarget && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center justify-center gap-1.5"
          style={{
            top: 24,
            backgroundColor: "oklch(from var(--reference-drop) l c h / 0.16)",
            backdropFilter: "blur(2px)",
          }}
        >
          <div
            className="font-mono text-2xs uppercase tracking-[0.08em]"
            style={{ color: "var(--reference-drop)" }}
          >
            Replace image
          </div>
          <div
            className="font-mono text-3xs"
            style={{ color: "oklch(from var(--reference-drop) l c h / 0.7)" }}
          >
            drop to swap &middot; keeps wire position {index}
          </div>
        </div>
      )}

      {/* Corner brackets - SVG L-shapes at slot corners, inset slightly outside. */}
      <CornerBrackets isDropTarget={isDropTarget} />
    </div>
  );
});

/**
 * Four L-shaped corner marks inset just outside the slot border. Color shifts
 * to --reference-drop when the slot is a drop target.
 */
function CornerBrackets({ isDropTarget }: { isDropTarget: boolean }) {
  const color = isDropTarget ? "var(--reference-drop)" : "var(--reference)";
  return (
    <div aria-hidden="true" className="pointer-events-none absolute" style={{ inset: -3, color }}>
      <Bracket position="tl" />
      <Bracket position="tr" />
      <Bracket position="bl" />
      <Bracket position="br" />
    </div>
  );
}

function Bracket({ position }: { position: "tl" | "tr" | "bl" | "br" }) {
  const styles: React.CSSProperties = {
    position: "absolute",
    width: 14,
    height: 14,
    ...(position === "tl" && { top: 0, left: 0 }),
    ...(position === "tr" && { top: 0, right: 0, transform: "scaleX(-1)" }),
    ...(position === "bl" && { bottom: 0, left: 0, transform: "scaleY(-1)" }),
    ...(position === "br" && { bottom: 0, right: 0, transform: "scale(-1, -1)" }),
  };
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      style={styles}
    >
      <path d="M0.5 13.5 L0.5 0.5 L13.5 0.5" />
    </svg>
  );
}
