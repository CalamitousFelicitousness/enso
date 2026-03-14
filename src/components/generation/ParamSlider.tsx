import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { getParamHelp } from "@/data/parameterHelp";
import { cn } from "@/lib/utils";

// ── Utility functions ──────────────────────────────────────────────

function deriveDecimals(step: number): number {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

function formatValue(value: number, decimals: number, suffix?: string): string {
  return value.toFixed(decimals) + (suffix ?? "");
}

function applySnap(
  raw: number,
  notches: number[] | undefined,
  snapRadius: number,
  range: number,
  shiftHeld: boolean,
): { value: number; snapped: boolean; snapTarget: number | null } {
  if (!notches || notches.length === 0 || shiftHeld) {
    return { value: raw, snapped: false, snapTarget: null };
  }
  const threshold = snapRadius * range;
  for (const n of notches) {
    if (Math.abs(raw - n) <= threshold) {
      return { value: n, snapped: true, snapTarget: n };
    }
  }
  return { value: raw, snapped: false, snapTarget: null };
}

// ── Props ──────────────────────────────────────────────────────────

interface ParamSliderProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  tooltip?: string;
  suffix?: string;
  decimals?: number;
  notches?: number[];
  snapRadius?: number;
  defaultValue?: number;
}

// ── Component ──────────────────────────────────────────────────────

export const ParamSlider = memo(function ParamSlider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  tooltip,
  suffix,
  decimals: decimalsProp,
  notches,
  snapRadius = 0.03,
  defaultValue,
}: ParamSliderProps) {
  const decimals = decimalsProp ?? deriveDecimals(step);
  const range = max - min;
  const fill = range === 0 ? 100 : Math.min(100, Math.max(0, ((value - min) / range) * 100));

  // ── Edit state ─────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState(false);
  const [snapTarget, setSnapTarget] = useState<number | null>(null);

  // ── Refs for drag state (avoid re-renders) ─────────────────────
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    active: false,
    startX: 0,
    startValue: 0,
    grabOffset: 0,
    moved: false,
    shiftHeld: false,
  });

  // ── Helpers ────────────────────────────────────────────────────

  const clamp = useCallback(
    (v: number) => {
      const clamped = Math.min(max, Math.max(min, v));
      // Round to step precision
      return Number((Math.round(clamped / step) * step).toFixed(decimals));
    },
    [min, max, step, decimals],
  );

  const positionToValue = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track) return min;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return min + ratio * range;
    },
    [min, range],
  );

  // ── Drag interaction ───────────────────────────────────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || editing) return;
      // Don't start drag if clicking the value span
      if ((e.target as HTMLElement).dataset.valueSpan) return;
      if (e.button !== 0) return;

      e.preventDefault();
      const track = trackRef.current;
      if (!track) return;
      track.setPointerCapture(e.pointerId);

      const cursorValue = positionToValue(e.clientX);
      dragRef.current = {
        active: true,
        startX: e.clientX,
        startValue: value,
        grabOffset: value - cursorValue,
        moved: false,
        shiftHeld: e.shiftKey,
      };
      setDragging(true);
    },
    [disabled, editing, positionToValue, value],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d.active) return;

      const dx = Math.abs(e.clientX - d.startX);
      if (dx > 2) d.moved = true;

      // Handle shift key transitions
      if (e.shiftKey !== d.shiftHeld) {
        d.startX = e.clientX;
        d.startValue = value;
        d.shiftHeld = e.shiftKey;
      }

      let raw: number;
      if (e.shiftKey) {
        // Precision mode: relative delta, 10× finer
        const pxDelta = e.clientX - d.startX;
        const track = trackRef.current;
        if (!track) return;
        const pxRange = track.getBoundingClientRect().width;
        raw = d.startValue + (pxDelta / pxRange) * range * 0.1;
      } else {
        // Normal: absolute cursor mapping with offset convergence
        const cursorValue = positionToValue(e.clientX);
        const convergePx = 30;
        const convergence = Math.min(1, dx / convergePx);
        const offset = d.grabOffset * (1 - convergence);
        raw = cursorValue + offset;
      }

      const snap = applySnap(raw, notches, snapRadius, range, e.shiftKey);
      setSnapTarget(snap.snapTarget);
      onChange(clamp(snap.value));
    },
    [value, range, positionToValue, notches, snapRadius, onChange, clamp],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d.active) return;
      d.active = false;
      setDragging(false);
      setSnapTarget(null);

      const track = trackRef.current;
      if (track) track.releasePointerCapture(e.pointerId);

      // Click-to-jump if no significant drag occurred (and not on value span)
      if (!d.moved && !(e.target as HTMLElement).dataset.valueSpan) {
        const raw = positionToValue(e.clientX);
        const snap = applySnap(raw, notches, snapRadius, range, e.shiftKey);
        onChange(clamp(snap.value));
      }
    },
    [positionToValue, notches, snapRadius, range, onChange, clamp],
  );

  // ── Click-to-edit ──────────────────────────────────────────────

  const startEdit = useCallback(() => {
    if (disabled) return;
    setDraft(formatValue(value, decimals));
    setEditing(true);
  }, [disabled, value, decimals]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    const parsed = parseFloat(draft);
    if (!isNaN(parsed)) {
      onChange(clamp(parsed));
    }
  }, [draft, onChange, clamp]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  // ── Mousewheel ─────────────────────────────────────────────────

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const handler = (e: WheelEvent) => {
      if (disabled) return;
      if (document.activeElement !== track) return;
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      const mult = e.shiftKey ? 0.1 : 1;
      onChange(clamp(value + step * mult * dir));
    };
    track.addEventListener("wheel", handler, { passive: false });
    return () => track.removeEventListener("wheel", handler);
  }, [disabled, value, step, onChange, clamp]);

  // ── Keyboard ───────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      const mult = e.shiftKey ? 0.1 : 1;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowUp":
          e.preventDefault();
          onChange(clamp(value + step * mult));
          break;
        case "ArrowLeft":
        case "ArrowDown":
          e.preventDefault();
          onChange(clamp(value - step * mult));
          break;
        case "Home":
          e.preventDefault();
          onChange(min);
          break;
        case "End":
          e.preventDefault();
          onChange(max);
          break;
        case "Enter":
          e.preventDefault();
          startEdit();
          break;
      }
    },
    [disabled, value, step, min, max, onChange, clamp, startEdit],
  );

  // ── Context menu helpers ───────────────────────────────────────

  const helpText = tooltip ?? getParamHelp(label);
  const hasReset = defaultValue !== undefined;
  const isAtDefault = hasReset && value === defaultValue;
  const hasContextItems = hasReset || !!helpText;

  // ── Snap tooltip state ─────────────────────────────────────────

  const [showHelp, setShowHelp] = useState(false);

  const triggerHelp = useCallback(() => {
    setShowHelp(true);
    setTimeout(() => setShowHelp(false), 3000);
  }, []);

  // ── Render ─────────────────────────────────────────────────────

  const trackContent = (
    <div
      ref={trackRef}
      data-param={label.toLowerCase()}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={tooltip || label}
      tabIndex={disabled ? -1 : 0}
      title={helpText}
      className={cn(
        "relative h-5 rounded-sm bg-muted/60 select-none overflow-hidden",
        disabled ? "opacity-50 pointer-events-none" : dragging ? "cursor-grabbing" : "cursor-ew-resize",
        "focus-visible:ring-1 focus-visible:ring-ring/50",
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      {/* Fill bar with oklch gradient */}
      <div
        className="absolute inset-y-0 left-0 rounded-sm pointer-events-none"
        style={{
          width: `${fill}%`,
          background: `linear-gradient(to right, oklch(from var(--primary) l c h / 0.08), oklch(from var(--primary) l c h / 0.20) 70%, oklch(from var(--primary) l c h / 0.28))`,
        }}
      />

      {/* Edge line at fill boundary */}
      {fill > 0 && fill < 100 && (
        <div
          className="absolute top-[3px] bottom-[3px] w-px bg-primary/60 pointer-events-none"
          style={{ left: `${fill}%` }}
        />
      )}

      {/* Boundary indicators */}
      {value <= min && (
        <div className="absolute left-0 top-[3px] bottom-[3px] w-0.5 bg-muted-foreground/30 pointer-events-none" />
      )}
      {value >= max && (
        <div className="absolute right-0 top-[3px] bottom-[3px] w-0.5 bg-primary/60 pointer-events-none" />
      )}

      {/* Notch ticks */}
      {notches?.map((n) => {
        const pos = range === 0 ? 0 : ((n - min) / range) * 100;
        if (pos < 0 || pos > 100) return null;
        return (
          <div
            key={n}
            className={cn(
              "absolute top-[3px] bottom-[3px] w-px pointer-events-none",
              snapTarget === n ? "bg-primary/60" : "bg-muted-foreground/20",
            )}
            style={{ left: `${pos}%` }}
          />
        );
      })}

      {/* Snap tooltip */}
      {snapTarget !== null && dragging && (
        <div
          className="absolute -top-6 text-3xs font-mono bg-popover/80 backdrop-blur-sm px-1 py-0.5 rounded-sm pointer-events-none z-10"
          style={{ left: `${range === 0 ? 0 : ((snapTarget - min) / range) * 100}%`, transform: "translateX(-50%)" }}
        >
          {formatValue(snapTarget, decimals)}
        </div>
      )}

      {/* Help tooltip */}
      {showHelp && helpText && (
        <div
          className="absolute -top-8 left-0 right-0 text-3xs bg-popover/90 backdrop-blur-sm px-2 py-1 rounded-sm pointer-events-none z-10 max-w-[200px]"
          dangerouslySetInnerHTML={{ __html: helpText }}
        />
      )}

      {/* Label text */}
      <span className="absolute inset-y-0 left-1.5 flex items-center text-3xs text-muted-foreground pointer-events-none leading-none">
        {label}
      </span>

      {/* Value text / edit input */}
      {editing ? (
        <input
          type="number"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
            if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
            e.stopPropagation();
          }}
          className="absolute inset-y-0 right-1.5 w-16 bg-transparent text-right font-mono text-3xs tabular-nums outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          min={min}
          max={max}
          step={step}
        />
      ) : (
        <span
          data-value-span=""
          onClick={(e) => { e.stopPropagation(); startEdit(); }}
          className={cn(
            "absolute inset-y-0 right-1.5 flex items-center text-3xs font-mono tabular-nums text-foreground/80 pointer-events-auto cursor-text leading-none transition-opacity duration-150",
            "hover:underline hover:decoration-dotted hover:underline-offset-2 hover:decoration-muted-foreground",
          )}
        >
          {formatValue(value, decimals, suffix)}
        </span>
      )}
    </div>
  );

  if (!hasContextItems) return trackContent;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{trackContent}</ContextMenuTrigger>
      <ContextMenuContent>
        {hasReset && (
          <ContextMenuItem disabled={isAtDefault} onSelect={() => onChange(defaultValue!)}>
            Reset to default ({formatValue(defaultValue!, decimals)})
          </ContextMenuItem>
        )}
        {hasReset && helpText && <ContextMenuSeparator />}
        {helpText && (
          <ContextMenuItem onSelect={triggerHelp}>Help</ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});
