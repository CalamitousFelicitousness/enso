// The DOM chrome every frame wears: a glass header anchored to the frame on
// the canvas, with the dock's tabs and drawer below it in panel mode, or a
// hat flush with the frame's top.

import { useMemo, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DOCK_LINE_HEIGHT, ELEMENT_GAP } from "@/lib/inputs/layout";

export const HEADER_HEIGHT = 30;
export const PANEL_WIDTH = 320;
const DRAWER_MAX_HEIGHT = 420;
const STROKE_HALF = 1;

const GLASS_BORDER = "rgba(42,42,62,0.5)";
const GLASS_BORDER_SUBTLE = "rgba(42,42,62,0.3)";
const GLASS_STYLE: React.CSSProperties = {
  backgroundColor: "rgba(17,17,24,0.85)",
  border: `1px solid ${GLASS_BORDER}`,
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04), 0 10px 15px -3px rgba(0,0,0,0.1)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
};

export interface DockTabProps {
  active: boolean;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  accent: string;
  onClick: () => void;
}

export function DockTab({ active, label, icon: Icon, accent, onClick }: DockTabProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex items-center gap-1 transition-colors"
      style={{
        padding: "3px 7px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 500,
        backgroundColor: active ? `${accent}26` : "transparent",
        color: active ? accent : "var(--muted-foreground)",
        boxShadow: active ? `inset 0 0 0 1px ${accent}66` : "none",
      }}
    >
      <Icon size={10} />
      {label}
    </button>
  );
}

/** One line of a dock's Info tab. */
export function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function Tether({
  accent,
  height,
}: {
  accent: string;
  /** Height in the panel's pre-scale coordinate space */
  height: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: "100%",
        left: "50%",
        transform: "translateX(-50%)",
        width: 1,
        height,
        background: `linear-gradient(to bottom, ${accent}99, ${accent}00)`,
        pointerEvents: "none",
      }}
    />
  );
}

export interface FrameHeaderProps {
  /** "panel": fixed width, above the frame with a gap, expandable drawer.
   * "hat": the frame's width, flush with its top, no drawer. */
  mode: "panel" | "hat";
  color: string;
  label: string;
  /** Shown right after the label in panel mode. */
  labelAdornment?: ReactNode;
  sizeText?: string | undefined;
  /** Shown after the size text: a state the frame is in. */
  status?: ReactNode;
  canvasX: number;
  canvasY?: number | undefined;
  frameW: number;
  viewport: { x: number; y: number; scale: number };
  labelScale: number;
  actions?: ReactNode;
  drawer?: ReactNode;
  collapsed?: boolean | undefined;
  onToggleCollapsed?: (() => void) | undefined;
  tabBar?: ReactNode;
  /** Content between the top separator and the tab bar, such as the role toggle. */
  subheader?: ReactNode;
  /** Panel mode: a second line under the header, shown collapsed or not. */
  statusLine?: ReactNode;
}

export function FrameHeader({
  mode,
  color,
  label,
  labelAdornment,
  sizeText,
  status,
  canvasX,
  canvasY = 0,
  frameW,
  viewport,
  labelScale,
  actions,
  drawer,
  collapsed,
  onToggleCollapsed,
  tabBar,
  subheader,
  statusLine,
}: FrameHeaderProps) {
  const combinedScale = viewport.scale * labelScale;

  const style = useMemo<React.CSSProperties>(() => {
    if (mode === "hat") {
      const anchorX = (canvasX - STROKE_HALF) * viewport.scale + viewport.x;
      const anchorY = (canvasY + STROKE_HALF) * viewport.scale + viewport.y;
      const widthPx = (frameW + STROKE_HALF * 2) / labelScale;
      return {
        position: "absolute",
        left: `${anchorX}px`,
        bottom: `calc(100% - ${anchorY}px)`,
        width: `${widthPx}px`,
        transform: `scale(${combinedScale})`,
        transformOrigin: "bottom left",
        pointerEvents: "auto" as const,
      };
    }
    // Panel mode anchors above the frame's top-left, ELEMENT_GAP away
    const screenLeftX = (canvasX - STROKE_HALF) * viewport.scale + viewport.x;
    const screenTopY =
      (canvasY + STROKE_HALF) * viewport.scale + viewport.y - ELEMENT_GAP * viewport.scale;
    return {
      position: "absolute",
      left: `${screenLeftX}px`,
      bottom: `calc(100% - ${screenTopY}px)`,
      width: `${PANEL_WIDTH}px`,
      transform: `scale(${combinedScale})`,
      transformOrigin: "bottom left",
      pointerEvents: "auto" as const,
    };
  }, [mode, canvasX, canvasY, frameW, viewport, labelScale, combinedScale]);

  const isPanel = mode === "panel";
  const showChevron = isPanel && drawer !== undefined && onToggleCollapsed;
  const showExpandedSection = isPanel && !collapsed && (subheader || tabBar || drawer);

  return (
    <div style={style} className="z-50" role="group" aria-label={label}>
      <div className="flex flex-col overflow-hidden rounded-md shadow-lg" style={GLASS_STYLE}>
        <div
          className="flex items-center justify-between px-3 shrink-0"
          style={{ minHeight: HEADER_HEIGHT }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="shrink-0 rounded-full"
              style={{ width: 6, height: 6, backgroundColor: color }}
            />
            <span className="text-[11px] font-medium text-foreground truncate">{label}</span>
            {labelAdornment}
            {sizeText && (
              <span className="text-[10px] text-muted-foreground font-mono tabular-nums shrink-0">
                {sizeText}
              </span>
            )}
            {status}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {actions}
            {showChevron && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapsed();
                }}
                title={collapsed ? "Expand settings" : "Collapse settings"}
                className="text-muted-foreground hover:bg-white/5"
              >
                {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </Button>
            )}
          </div>
        </div>

        {isPanel && statusLine && (
          <div
            className="flex items-center gap-2 px-3 shrink-0"
            style={{ height: DOCK_LINE_HEIGHT, borderTop: `1px solid ${GLASS_BORDER_SUBTLE}` }}
          >
            {statusLine}
          </div>
        )}

        {showExpandedSection && (
          <div style={{ borderTop: `1px solid ${GLASS_BORDER_SUBTLE}` }}>
            {subheader && <div className="px-3 pt-2">{subheader}</div>}
            {tabBar && <div className="flex items-center gap-1 px-3 pt-2 pb-1">{tabBar}</div>}
            {drawer && (
              <div
                className="p-3 overflow-y-auto flex flex-col gap-2"
                style={{ maxHeight: DRAWER_MAX_HEIGHT }}
              >
                {drawer}
              </div>
            )}
          </div>
        )}
      </div>

      {isPanel && <Tether accent={color} height={ELEMENT_GAP / labelScale} />}
    </div>
  );
}
