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
): number {
  if (!notches || notches.length === 0 || shiftHeld) return raw;
  const threshold = snapRadius * range;
  for (const n of notches) {
    if (Math.abs(raw - n) <= threshold) return n;
  }
  return raw;
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
  /** Search keywords for the Command Palette. Extracted at build time by vite/extract-params.ts. */
  keywords?: string[];
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
  const fill = range === 0 ? 100 : ((value - min) / range) * 100;

  // ── State ──────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState(false);

  // ── Refs ────────────────────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef({
    startX: 0,
    startValue: 0,
    moved: false,
    shiftHeld: false,
    lastValue: 0,
  });

  // ── Helpers ────────────────────────────────────────────────────

  const clampToStep = useCallback(
    (raw: number) => {
      const stepped = Math.round((raw - min) / step) * step + min;
      return Math.min(max, Math.max(min, Number(stepped.toFixed(decimals))));
    },
    [min, max, step, decimals],
  );

  /** Imperative visual update — sets fill width, edge position, value text */
  const updateVisuals = useCallback(
    (val: number) => {
      const pct = range === 0 ? 100 : Math.min(100, Math.max(0, ((val - min) / range) * 100));
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (valueRef.current) valueRef.current.textContent = formatValue(val, decimals, suffix);
    },
    [min, range, decimals, suffix],
  );

  // ── Drag interaction ───────────────────────────────────────────
  // No onChange during drag — only imperative DOM updates.
  // onChange fires once on pointerUp with the final value.

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || editing) return;
      if ((e.target as HTMLElement).dataset.valueSpan) return;
      if (e.button !== 0) return;

      e.preventDefault();
      const track = trackRef.current;
      if (!track) return;
      track.setPointerCapture(e.pointerId);

      const d = dragRef.current;
      d.startX = e.clientX;
      d.startValue = value;
      d.moved = false;
      d.shiftHeld = e.shiftKey;
      d.lastValue = value;
      setDragging(true);
    },
    [disabled, editing, value],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const track = trackRef.current;
      if (!track) return;

      const d = dragRef.current;
      const dx = Math.abs(e.clientX - d.startX);
      if (dx > 2) d.moved = true;

      // Re-anchor on shift key transitions to avoid jolts
      if (e.shiftKey !== d.shiftHeld) {
        d.startX = e.clientX;
        d.startValue = d.lastValue;
        d.shiftHeld = e.shiftKey;
      }

      const rect = track.getBoundingClientRect();
      let raw: number;

      if (e.shiftKey) {
        // Precision mode: relative delta, 10× finer
        const pxDelta = e.clientX - d.startX;
        raw = d.startValue + (pxDelta / rect.width) * range * 0.1;
      } else {
        // Absolute mode: cursor position maps directly to value
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        raw = min + frac * range;
      }

      const snapped = applySnap(raw, notches, snapRadius, range, e.shiftKey);
      const clamped = clampToStep(snapped);

      if (clamped === d.lastValue) return;
      d.lastValue = clamped;

      // Imperative visual update only — no store update, no re-render
      updateVisuals(clamped);
    },
    [dragging, min, range, notches, snapRadius, clampToStep, updateVisuals],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const d = dragRef.current;
      setDragging(false);

      const track = trackRef.current;
      if (track) track.releasePointerCapture(e.pointerId);

      if (!d.moved && !(e.target as HTMLElement).dataset.valueSpan) {
        // Click-to-jump — direct to cursor position
        if (track) {
          const rect = track.getBoundingClientRect();
          const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const raw = min + frac * range;
          const snapped = applySnap(raw, notches, snapRadius, range, e.shiftKey);
          onChange(clampToStep(snapped));
        }
      } else {
        // Commit final drag value
        onChange(d.lastValue);
      }
    },
    [dragging, min, range, notches, snapRadius, clampToStep, onChange],
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
    if (!isNaN(parsed)) onChange(clampToStep(parsed));
  }, [draft, onChange, clampToStep]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  // ── Mousewheel (focus-gated) ───────────────────────────────────

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const handler = (e: WheelEvent) => {
      if (disabled || document.activeElement !== track) return;
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      const mult = e.shiftKey ? 0.1 : 1;
      onChange(clampToStep(value + step * mult * dir));
    };
    track.addEventListener("wheel", handler, { passive: false });
    return () => track.removeEventListener("wheel", handler);
  }, [disabled, value, step, onChange, clampToStep]);

  // ── Keyboard ───────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      const mult = e.shiftKey ? 0.1 : 1;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowUp":
          e.preventDefault();
          onChange(clampToStep(value + step * mult));
          break;
        case "ArrowLeft":
        case "ArrowDown":
          e.preventDefault();
          onChange(clampToStep(value - step * mult));
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
    [disabled, value, step, min, max, onChange, clampToStep, startEdit],
  );

  // ── Context menu ───────────────────────────────────────────────

  const helpText = tooltip ?? getParamHelp(label);
  const hasReset = defaultValue !== undefined;
  const isAtDefault = hasReset && value === defaultValue;
  const hasContextItems = hasReset || !!helpText;

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
      {/* Fill bar with U-shaped edge glow via inset box-shadow */}
      <div
        ref={fillRef}
        className={cn(
          "absolute inset-y-0 left-0 rounded-sm pointer-events-none",
          dragging ? "transition-none" : "transition-[width,box-shadow] duration-200 ease-out",
        )}
        style={{
          width: `${fill}%`,
          background: `linear-gradient(to right, oklch(from var(--primary) l c h / 0.08), oklch(from var(--primary) l c h / 0.20) 70%, oklch(from var(--primary) l c h / 0.28))`,
          boxShadow: fill > 0 && fill < 100
            ? `inset -1px 0 0 0 oklch(from var(--primary) l c h / 0.6), inset -4px 0 6px -3px oklch(from var(--primary) l c h / 0.2)`
            : "none",
        }}
      />

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
            className="absolute top-[3px] bottom-[3px] w-px pointer-events-none bg-muted-foreground/20"
            style={{ left: `${pos}%` }}
          />
        );
      })}

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
          ref={valueRef}
          data-value-span=""
          onClick={(e) => { e.stopPropagation(); startEdit(); }}
          className="absolute inset-y-0 right-1.5 flex items-center text-3xs font-mono tabular-nums text-foreground/80 pointer-events-auto cursor-text leading-none hover:underline hover:decoration-dotted hover:underline-offset-2 hover:decoration-muted-foreground"
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
