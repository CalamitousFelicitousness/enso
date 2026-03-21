import { useMemo, useCallback, useEffect, useState, type ReactNode } from "react";
import { useCanvasStore, type ImageLayer } from "@/stores/canvasStore";
import { useControlStore } from "@/stores/controlStore";
import { UNIT_TYPE_LABELS } from "@/api/types/control";
import { useGenerationStore } from "@/stores/generationStore";
import { useUiStore } from "@/stores/uiStore";
import { useServerInfo } from "@/api/hooks/useServer";
import { ControlUnitControls } from "@/components/generation/tabs/control/ControlUnitControls";
import { LayerPanel } from "@/components/generation/LayerPanel";
import { MaskParams } from "@/components/generation/MaskParams";
import {
  ChevronUp,
  ChevronDown,
  ImagePlus,
  Trash2,
  Minimize2,
  Maximize2,
  Move,
  ArrowLeftFromLine,
  Hand,
  LocateFixed,
  Download,
  Layers,
  SlidersHorizontal,
} from "lucide-react";
import type { FitMode } from "@/lib/image";
import { Button } from "@/components/ui/button";
import { ParamSlider } from "@/components/generation/ParamSlider";
import {
  downloadImage,
  generateImageFilename,
  resolveImageSrc,
} from "@/lib/utils";
import type { GenerationInfo } from "@/api/types/generation";
import { fileToBase64 } from "@/lib/image";
import { toast } from "sonner";
import {
  ELEMENT_GAP,
  PROCESSED_HEADER_HEIGHT,
  type CanvasLayout,
  type ControlFramePosition,
} from "./useControlFrameLayout";
import { resolveOutputSize } from "@/lib/sizeCompute";

export const HEADER_HEIGHT = 30;
const DRAWER_MAX_HEIGHT = 420;
export const PANEL_WIDTH = 320;
const STROKE_HALF = 1;
const CONTROL_COLOR = "#f59e0b";
export const INPUT_COLOR_ACTIVE = "#4ade80";
export const INPUT_COLOR_REFERENCE = "#38bdf8";
export const INPUT_COLOR_INACTIVE = "#6b7280";
export const OUTPUT_COLOR = "#60a5fa";
const PROCESSED_COLOR = "#c084fc";
const INPUT_PANEL_KEY = -1;
const OUTPUT_PANEL_KEY = -2;

// Glass dock styling
const GLASS_BORDER = "rgba(42,42,62,0.5)";
const GLASS_BORDER_SUBTLE = "rgba(42,42,62,0.3)";
const GLASS_STYLE: React.CSSProperties = {
  backgroundColor: "rgba(17,17,24,0.85)",
  border: `1px solid ${GLASS_BORDER}`,
  boxShadow:
    "inset 0 0 0 1px rgba(255,255,255,0.04), 0 10px 15px -3px rgba(0,0,0,0.1)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
};

// ─── DockTab ────────────────────────────────────────────────────────────────

interface DockTabProps {
  active: boolean;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  accent: string;
  onClick: () => void;
}

function DockTab({ active, label, icon: Icon, accent, onClick }: DockTabProps) {
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

// ─── InfoRow ────────────────────────────────────────────────────────────────

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={`text-[10px] text-foreground ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Tether ─────────────────────────────────────────────────────────────────

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

// ─── Unified FrameHeader ────────────────────────────────────────────────────
//
// Two modes:
//   "panel" — fixed 320px width, positioned above frame with gap, expandable drawer
//   "hat"   — matches frame width, flush to frame top, no drawer
//
// Both modes use glass dock styling with accent-colored dot.

export interface FrameHeaderProps {
  mode: "panel" | "hat";
  color: string;
  label: string;
  sizeText?: string;
  canvasX: number;
  canvasY?: number;
  frameW: number;
  viewport: { x: number; y: number; scale: number };
  labelScale: number;
  actions?: ReactNode;
  drawer?: ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  tabBar?: ReactNode;
}

export function FrameHeader({
  mode,
  color,
  label,
  sizeText,
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
    const screenLeftX = (canvasX - STROKE_HALF) * viewport.scale + viewport.x;
    const screenTopY =
      STROKE_HALF * viewport.scale + viewport.y - ELEMENT_GAP * viewport.scale;
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
  const showExpandedSection = isPanel && !collapsed && (tabBar || drawer);

  return (
    <div style={style} className="z-50">
      <div
        className="flex flex-col overflow-hidden rounded-md shadow-lg"
        style={GLASS_STYLE}
      >
        {/* Glass header row */}
        <div
          className="flex items-center justify-between px-3 shrink-0"
          style={{ minHeight: HEADER_HEIGHT }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="shrink-0 rounded-full"
              style={{ width: 6, height: 6, backgroundColor: color }}
            />
            <span className="text-[11px] font-medium text-foreground truncate">
              {label}
            </span>
            {sizeText && (
              <span className="text-[10px] text-muted-foreground font-mono tabular-nums shrink-0">
                {sizeText}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {actions}
            {showChevron && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapsed!();
                }}
                title={collapsed ? "Expand settings" : "Collapse settings"}
                className="text-muted-foreground hover:bg-white/5"
              >
                {collapsed ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronUp size={12} />
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Expandable section: tabs + drawer */}
        {showExpandedSection && (
          <div style={{ borderTop: `1px solid ${GLASS_BORDER_SUBTLE}` }}>
            {tabBar && (
              <div className="flex items-center gap-1 px-3 pt-2 pb-1">
                {tabBar}
              </div>
            )}
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

      {/* Tether line (panel mode only) */}
      {isPanel && (
        <Tether accent={color} height={ELEMENT_GAP / labelScale} />
      )}
    </div>
  );
}

// ─── Control unit panel (one per unit, no positioning) ──────────────────────

interface UnitPanelProps {
  unitIndex: number;
  isOwner: boolean;
  collapsed: boolean;
  genSize: { width: number; height: number };
  onPickImage?: (unitIndex: number) => void;
  onClearImage?: (unitIndex: number) => void;
}

function UnitPanel({
  unitIndex,
  isOwner,
  collapsed,
  genSize,
  onPickImage,
  onClearImage,
}: UnitPanelProps) {
  const togglePanelCollapsed = useCanvasStore((s) => s.togglePanelCollapsed);
  const setSelectedControlFrame = useCanvasStore(
    (s) => s.setSelectedControlFrame,
  );
  const unit = useControlStore((s) => s.units[unitIndex]);
  const setUnitParam = useControlStore((s) => s.setUnitParam);
  const setFreeTransform = useControlStore((s) => s.setFreeTransform);
  const { width: genW, height: genH } = genSize;
  const [activeTab, setActiveTab] = useState<"info" | "params">("info");

  if (!unit) return null;

  const imageDims = isOwner ? unit.imageDims : null;
  const unifiedIndex = unitIndex + 2;
  const isReference = unit.unitType === "reference";
  const panelColor = isReference ? INPUT_COLOR_REFERENCE : CONTROL_COLOR;
  const roleLabel = isReference
    ? "Reference"
    : `Control: ${UNIT_TYPE_LABELS[unit.unitType] ?? unit.unitType}`;
  const labelText = `Input ${unifiedIndex} (${roleLabel})`;

  let sizeText: string | null = null;
  if (isOwner) {
    if (isReference) {
      sizeText = imageDims
        ? `${imageDims.w}\u00d7${imageDims.h}`
        : `${genW}\u00d7${genH}`;
    } else if (unit.fitMode === "free") {
      sizeText = imageDims
        ? `${imageDims.w}\u00d7${imageDims.h} free`
        : `${genW}\u00d7${genH}`;
    } else {
      const fitSuffix =
        unit.fitMode === "contain"
          ? "fit"
          : unit.fitMode === "cover"
            ? "crop"
            : "stretch";
      sizeText = imageDims
        ? `${imageDims.w}\u00d7${imageDims.h} \u2192 ${genW}\u00d7${genH} ${fitSuffix}`
        : `${genW}\u00d7${genH}`;
    }
  }

  const handlePanelClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedControlFrame(unitIndex);
  };

  const fitIcon =
    unit.fitMode === "contain" ? (
      <Minimize2 size={14} />
    ) : unit.fitMode === "cover" ? (
      <Maximize2 size={14} />
    ) : unit.fitMode === "fill" ? (
      <Move size={14} />
    ) : (
      <Hand size={14} />
    );

  const hasExpandableContent = !isReference;

  const infoContent = (
    <div className="flex flex-col gap-1.5">
      <InfoRow
        label="Type"
        value={UNIT_TYPE_LABELS[unit.unitType] ?? unit.unitType}
      />
      {unit.model && unit.model !== "None" && (
        <InfoRow label="Model" value={unit.model} />
      )}
      {imageDims && (
        <InfoRow
          label="Dimensions"
          value={`${imageDims.w}\u00d7${imageDims.h}`}
          mono
        />
      )}
      {!isReference && <InfoRow label="Fit" value={unit.fitMode} />}
    </div>
  );

  return (
    <div
      className="flex flex-col overflow-hidden rounded-md shadow-lg"
      style={GLASS_STYLE}
      onClick={handlePanelClick}
    >
      {/* Glass header */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{ minHeight: HEADER_HEIGHT }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="shrink-0 rounded-full"
            style={{ width: 6, height: 6, backgroundColor: panelColor }}
          />
          <span className="text-[11px] font-medium text-foreground truncate">
            {labelText}
          </span>
          {sizeText && (
            <span className="text-[10px] text-muted-foreground font-mono tabular-nums shrink-0">
              {sizeText}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {isOwner && unit.image && (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onPickImage?.(unitIndex);
                }}
                title="Replace image"
                className="text-muted-foreground hover:bg-white/5"
              >
                <ImagePlus size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearImage?.(unitIndex);
                }}
                title="Clear image"
                className="text-muted-foreground hover:bg-white/5"
              >
                <Trash2 size={14} />
              </Button>
            </>
          )}
          {isOwner && unit.image && !isReference && (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  const next: FitMode =
                    unit.fitMode === "contain"
                      ? "cover"
                      : unit.fitMode === "cover"
                        ? "fill"
                        : unit.fitMode === "fill"
                          ? "free"
                          : "contain";
                  if (next === "free" || unit.fitMode === "free")
                    setFreeTransform(unitIndex, null);
                  setUnitParam(unitIndex, "fitMode", next);
                }}
                title={`Fit: ${unit.fitMode}`}
                className="text-muted-foreground hover:bg-white/5"
              >
                {fitIcon}
              </Button>
              {unit.fitMode === "free" && unit.freeTransform !== null && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFreeTransform(unitIndex, null);
                  }}
                  title="Re-center image"
                  className="text-muted-foreground hover:bg-white/5"
                >
                  <LocateFixed size={14} />
                </Button>
              )}
            </>
          )}
          {hasExpandableContent && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                togglePanelCollapsed(unitIndex, collapsed);
              }}
              title={collapsed ? "Expand settings" : "Collapse settings"}
              className="text-muted-foreground hover:bg-white/5"
            >
              {collapsed ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronUp size={12} />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Expandable section with tabs */}
      {hasExpandableContent && !collapsed && (
        <div style={{ borderTop: `1px solid ${GLASS_BORDER_SUBTLE}` }}>
          <div className="flex items-center gap-1 px-3 pt-2 pb-1">
            <DockTab
              active={activeTab === "info"}
              label="Info"
              icon={Layers}
              accent={panelColor}
              onClick={() => setActiveTab("info")}
            />
            <DockTab
              active={activeTab === "params"}
              label="Options"
              icon={SlidersHorizontal}
              accent={panelColor}
              onClick={() => setActiveTab("params")}
            />
          </div>
          <div
            className="p-3 overflow-y-auto flex flex-col gap-2"
            style={{ maxHeight: DRAWER_MAX_HEIGHT }}
          >
            {activeTab === "info" ? (
              infoContent
            ) : (
              <ControlUnitControls index={unitIndex} compact />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ControlFrameStack: positioned container for stacked unit panels ────────

interface ControlFrameStackProps {
  frame: ControlFramePosition;
  genSize: { width: number; height: number };
  onPickImage?: (unitIndex: number) => void;
  onClearImage?: (unitIndex: number) => void;
}

function ControlFrameStack({
  frame,
  genSize,
  onPickImage,
  onClearImage,
}: ControlFrameStackProps) {
  const viewport = useCanvasStore((s) => s.viewport);
  const labelScale = useUiStore((s) => s.canvasLabelScale);
  const panelCollapsedOverrides = useCanvasStore(
    (s) => s.panelCollapsedOverrides,
  );
  const units = useControlStore((s) => s.units);

  const containerStyle = useMemo(() => {
    const screenLeftX = (frame.x - STROKE_HALF) * viewport.scale + viewport.x;
    const screenTopY =
      frame.y * viewport.scale + viewport.y - ELEMENT_GAP * viewport.scale;
    const combinedScale = viewport.scale * labelScale;

    return {
      position: "absolute" as const,
      left: `${screenLeftX}px`,
      bottom: `calc(100% - ${screenTopY}px)`,
      width: `${PANEL_WIDTH}px`,
      transform: `scale(${combinedScale})`,
      transformOrigin: "bottom left",
      display: "flex",
      flexDirection: "column" as const,
      gap: "4px",
      pointerEvents: "auto" as const,
    };
  }, [frame, viewport, labelScale]);

  const referencingSlots = frame.processedSlots.filter(
    (s) => s.unitIndex !== frame.unitIndex,
  );

  const ownerUnit = units[frame.unitIndex];
  if (!ownerUnit) return null;

  const ownerHasImage = ownerUnit.image !== null;
  const ownerOverride = panelCollapsedOverrides.get(frame.unitIndex);
  const ownerCollapsed =
    ownerOverride !== undefined ? ownerOverride : !ownerHasImage;

  const isReference = ownerUnit.unitType === "reference";
  const tetherColor = isReference ? INPUT_COLOR_REFERENCE : CONTROL_COLOR;

  return (
    <div style={containerStyle} className="z-50">
      {referencingSlots.map((slot) => {
        const override = panelCollapsedOverrides.get(slot.unitIndex);
        const isCollapsed = override !== undefined ? override : true;
        return (
          <UnitPanel
            key={slot.unitIndex}
            unitIndex={slot.unitIndex}
            isOwner={false}
            collapsed={isCollapsed}
            genSize={genSize}
          />
        );
      })}
      <UnitPanel
        unitIndex={frame.unitIndex}
        isOwner
        collapsed={ownerCollapsed}
        genSize={genSize}
        onPickImage={onPickImage}
        onClearImage={onClearImage}
      />
      <Tether accent={tetherColor} height={ELEMENT_GAP / labelScale} />
    </div>
  );
}

// ─── Input frame panel (uses FrameHeader in panel mode) ─────────────────────

function InputFramePanel({
  canvasX,
  frameW,
  genSize,
  viewport,
  labelScale,
  onPickImage,
  onClearAll,
}: {
  canvasX: number;
  frameW: number;
  genSize: { width: number; height: number };
  viewport: { x: number; y: number; scale: number };
  labelScale: number;
  onPickImage?: () => void;
  onClearAll?: () => void;
}) {
  const layers = useCanvasStore((s) => s.layers);
  const inputRole = useCanvasStore((s) => s.inputRole);
  const setInputRole = useCanvasStore((s) => s.setInputRole);
  const panelCollapsedOverrides = useCanvasStore(
    (s) => s.panelCollapsedOverrides,
  );
  const togglePanelCollapsed = useCanvasStore((s) => s.togglePanelCollapsed);
  const denoisingStrength = useGenerationStore((s) => s.denoisingStrength);
  const setParam = useGenerationStore((s) => s.setParam);
  const pixelW = useGenerationStore((s) => s.width);
  const pixelH = useGenerationStore((s) => s.height);
  const hasLayers = layers.length > 0;
  const isReference = inputRole === "reference";
  const supportsStrength =
    useServerInfo().data?.model?.supports_strength ?? true;
  const [activeTab, setActiveTab] = useState<"info" | "params">("info");

  // Auto-switch to reference when model doesn't support strength
  useEffect(() => {
    if (!supportsStrength && inputRole === "initial") {
      setInputRole("reference");
    }
  }, [supportsStrength]); // eslint-disable-line react-hooks/exhaustive-deps -- only react to model capability changes

  const handleRoleChange = useCallback(
    (role: "initial" | "reference") => {
      if (role === inputRole) return;
      if (role === "initial" && !supportsStrength) {
        toast.info(
          "This model uses the image as a reference - denoising strength has no effect.",
        );
      }
      setInputRole(role);
    },
    [inputRole, setInputRole, supportsStrength],
  );

  const firstImage = layers.find((l): l is ImageLayer => l.type === "image");

  const override = panelCollapsedOverrides.get(INPUT_PANEL_KEY);
  const collapsed = override !== undefined ? override : !hasLayers;

  const baseSizeText = firstImage
    ? `${firstImage.naturalWidth}\u00d7${firstImage.naturalHeight}`
    : `${pixelW}\u00d7${pixelH}`;
  const sizeText =
    genSize.width !== pixelW || genSize.height !== pixelH
      ? `${baseSizeText} \u2192 ${genSize.width}\u00d7${genSize.height}`
      : baseSizeText;

  const handleDenoising = useCallback(
    (v: number) => setParam("denoisingStrength", v),
    [setParam],
  );

  const inputColor = !hasLayers
    ? INPUT_COLOR_INACTIVE
    : isReference
      ? INPUT_COLOR_REFERENCE
      : INPUT_COLOR_ACTIVE;

  const actions = hasLayers ? (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => onPickImage?.()}
        title="Add image"
        className="text-muted-foreground hover:bg-white/5"
      >
        <ImagePlus size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => onClearAll?.()}
        title="Clear all"
        className="text-muted-foreground hover:bg-white/5"
      >
        <Trash2 size={14} />
      </Button>
    </>
  ) : undefined;

  const label = isReference ? "Input 1 (Reference)" : "Input 1 (Initial)";

  const roleToggle = (
    <div className="flex items-center gap-0.5 rounded-md p-0.5 bg-white/5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleRoleChange("initial");
        }}
        className="px-2 py-0.5 text-[10px] font-medium rounded-sm transition-colors"
        style={{
          backgroundColor: !isReference ? `${inputColor}26` : "transparent",
          color: !isReference ? inputColor : "var(--muted-foreground)",
        }}
      >
        Initial
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleRoleChange("reference");
        }}
        className="px-2 py-0.5 text-[10px] font-medium rounded-sm transition-colors"
        style={{
          backgroundColor: isReference ? `${inputColor}26` : "transparent",
          color: isReference ? inputColor : "var(--muted-foreground)",
        }}
      >
        Reference
      </button>
    </div>
  );

  const tabBar = (
    <>
      <DockTab
        active={activeTab === "info"}
        label="Info"
        icon={Layers}
        accent={inputColor}
        onClick={() => setActiveTab("info")}
      />
      <DockTab
        active={activeTab === "params"}
        label="Options"
        icon={SlidersHorizontal}
        accent={inputColor}
        onClick={() => setActiveTab("params")}
      />
    </>
  );

  const drawer =
    activeTab === "info" ? (
      <div className="flex flex-col gap-2">
        {roleToggle}
        <InfoRow label="Resolution" value={sizeText} mono />
        {firstImage && (
          <InfoRow
            label="Source"
            value={`${firstImage.naturalWidth}\u00d7${firstImage.naturalHeight}`}
            mono
          />
        )}
      </div>
    ) : (
      <>
        {!isReference && (
          <ParamSlider
            label="Denoise"
            value={denoisingStrength}
            onChange={handleDenoising}
            min={0}
            max={1}
            step={0.05}
            disabled={!hasLayers}
          />
        )}
        <LayerPanel />
        {!isReference && <MaskParams />}
      </>
    );

  return (
    <FrameHeader
      mode="panel"
      color={inputColor}
      label={label}
      sizeText={sizeText}
      canvasX={canvasX}
      frameW={frameW}
      viewport={viewport}
      labelScale={labelScale}
      actions={actions}
      tabBar={tabBar}
      drawer={drawer}
      collapsed={collapsed}
      onToggleCollapsed={() => togglePanelCollapsed(INPUT_PANEL_KEY, collapsed)}
    />
  );
}

// ─── Output frame panel (uses FrameHeader in panel mode) ────────────────────

function OutputFramePanel({
  canvasX,
  viewport,
  frameW,
  labelScale,
  sizeText,
}: {
  canvasX: number;
  viewport: { x: number; y: number; scale: number };
  frameW: number;
  labelScale: number;
  sizeText: string;
}) {
  const selectedResultId = useGenerationStore((s) => s.selectedResultId);
  const selectedImageIndex = useGenerationStore((s) => s.selectedImageIndex);
  const results = useGenerationStore((s) => s.results);
  const addImageLayer = useCanvasStore((s) => s.addImageLayer);
  const panelCollapsedOverrides = useCanvasStore(
    (s) => s.panelCollapsedOverrides,
  );
  const togglePanelCollapsed = useCanvasStore((s) => s.togglePanelCollapsed);
  const [activeTab, setActiveTab] = useState<"info" | "params">("info");

  const selectedResult = useMemo(
    () => results.find((r) => r.id === selectedResultId),
    [results, selectedResultId],
  );

  const hasSelectedImage =
    selectedResult !== undefined &&
    selectedImageIndex !== null &&
    selectedResult.images[selectedImageIndex] !== undefined;

  // Parse generation info from selected result
  const genInfo = useMemo<GenerationInfo | null>(() => {
    if (!selectedResult?.info) return null;
    try {
      return JSON.parse(selectedResult.info) as GenerationInfo;
    } catch {
      return null;
    }
  }, [selectedResult]);

  const override = panelCollapsedOverrides.get(OUTPUT_PANEL_KEY);
  const collapsed = override !== undefined ? override : !hasSelectedImage;

  const handleSendToInput = useCallback(async () => {
    if (!selectedResult || selectedImageIndex === null) return;
    const imageUrl = selectedResult.images[selectedImageIndex];
    if (!imageUrl) return;
    const resp = await fetch(imageUrl);
    const blob = await resp.blob();
    const file = new File([blob], "from-output.png", { type: "image/png" });
    const base64 = await fileToBase64(file);
    const objectUrl = URL.createObjectURL(file);
    const img = new window.Image();
    img.src = objectUrl;
    await new Promise<void>((r) => {
      img.onload = () => r();
    });
    addImageLayer(file, base64, objectUrl, img.naturalWidth, img.naturalHeight);
  }, [selectedResult, selectedImageIndex, addImageLayer]);

  const handleDownload = useCallback(() => {
    if (!selectedResult || selectedImageIndex === null) return;
    const raw = selectedResult.images[selectedImageIndex];
    if (!raw) return;
    const src = resolveImageSrc(raw);
    const filename = generateImageFilename(
      selectedResult.info,
      selectedImageIndex,
    );
    downloadImage(src, filename);
  }, [selectedResult, selectedImageIndex]);

  const actions = (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={handleDownload}
        disabled={!hasSelectedImage}
        title="Download output image"
        className="text-muted-foreground hover:bg-white/5 disabled:opacity-30"
      >
        <Download size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={handleSendToInput}
        disabled={!hasSelectedImage}
        title="Send selected output to Input frame"
        className="text-muted-foreground hover:bg-white/5 disabled:opacity-30"
      >
        <ArrowLeftFromLine size={14} />
      </Button>
    </>
  );

  const tabBar = (
    <>
      <DockTab
        active={activeTab === "info"}
        label="Info"
        icon={Layers}
        accent={OUTPUT_COLOR}
        onClick={() => setActiveTab("info")}
      />
      <DockTab
        active={activeTab === "params"}
        label="Options"
        icon={SlidersHorizontal}
        accent={OUTPUT_COLOR}
        onClick={() => setActiveTab("params")}
      />
    </>
  );

  const drawer =
    activeTab === "info" ? (
      <div className="flex flex-col gap-1.5">
        <InfoRow label="Size" value={sizeText} mono />
        {genInfo?.model && <InfoRow label="Model" value={genInfo.model} />}
        {genInfo?.sampler_name && (
          <InfoRow label="Sampler" value={genInfo.sampler_name} />
        )}
      </div>
    ) : (
      <div className="flex flex-col gap-1.5">
        {genInfo?.steps !== undefined && (
          <InfoRow label="Steps" value={String(genInfo.steps)} mono />
        )}
        {genInfo?.cfg_scale !== undefined && (
          <InfoRow label="CFG" value={String(genInfo.cfg_scale)} mono />
        )}
        {genInfo?.seed !== undefined && (
          <InfoRow label="Seed" value={String(genInfo.seed)} mono />
        )}
        {!genInfo && (
          <span className="text-[10px] text-muted-foreground">
            No generation data
          </span>
        )}
      </div>
    );

  return (
    <FrameHeader
      mode="panel"
      color={OUTPUT_COLOR}
      label="Output"
      sizeText={sizeText}
      canvasX={canvasX}
      frameW={frameW}
      viewport={viewport}
      labelScale={labelScale}
      actions={actions}
      tabBar={tabBar}
      drawer={drawer}
      collapsed={collapsed}
      onToggleCollapsed={() =>
        togglePanelCollapsed(OUTPUT_PANEL_KEY, collapsed)
      }
    />
  );
}

// ─── Processed frame header (uses FrameHeader in hat mode) ──────────────────

function ProcessedFrameHeader({
  canvasX,
  canvasY,
  viewport,
  frameW,
  labelScale,
  sizeText,
  label,
  imageSrc,
}: {
  canvasX: number;
  canvasY?: number;
  viewport: { x: number; y: number; scale: number };
  frameW: number;
  labelScale: number;
  sizeText?: string;
  label?: string;
  imageSrc?: string | null;
}) {
  const compositeProcessed = useControlStore((s) => s.compositeProcessed);
  const units = useControlStore((s) => s.units);

  const processedSrc = useMemo(() => {
    if (imageSrc !== undefined) return imageSrc;
    if (compositeProcessed) return compositeProcessed;
    const first = units.find((u) => u.enabled && !!u.processedImage);
    return first?.processedImage ?? null;
  }, [imageSrc, compositeProcessed, units]);

  const handleDownload = useCallback(() => {
    if (!processedSrc) return;
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    downloadImage(processedSrc, `processed_${timestamp}.png`);
  }, [processedSrc]);

  const actions = (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={handleDownload}
      disabled={!processedSrc}
      title="Download processed image"
      className="text-muted-foreground hover:bg-white/5 disabled:opacity-30"
    >
      <Download size={14} />
    </Button>
  );

  return (
    <FrameHeader
      mode="hat"
      color={PROCESSED_COLOR}
      label={label ?? "Processed"}
      sizeText={sizeText}
      canvasX={canvasX}
      canvasY={canvasY}
      frameW={frameW}
      viewport={viewport}
      labelScale={labelScale}
      actions={actions}
    />
  );
}

// ─── Top-level: renders all frame panels and headers ────────────────────────

interface ControlFramePanelsProps {
  layout: CanvasLayout;
  onPickImage?: (unitIndex: number) => void;
  onClearImage?: (unitIndex: number) => void;
  onClearAll?: () => void;
}

export function ControlFramePanels({
  layout,
  onPickImage,
  onClearImage,
  onClearAll,
}: ControlFramePanelsProps) {
  const viewport = useCanvasStore((s) => s.viewport);
  const labelScale = useUiStore((s) => s.canvasLabelScale);
  const units = useControlStore((s) => s.units);

  const hiresEnabled = useGenerationStore((s) => s.hiresEnabled);
  const hiresScale = useGenerationStore((s) => s.hiresScale);
  const hiresResizeX = useGenerationStore((s) => s.hiresResizeX);
  const hiresResizeY = useGenerationStore((s) => s.hiresResizeY);

  const { genSize, displayW } = layout;
  const genSizeText = `${genSize.width}\u00d7${genSize.height}`;
  const outputSize = resolveOutputSize(
    genSize,
    hiresEnabled,
    hiresScale,
    hiresResizeX,
    hiresResizeY,
  );
  const outputSizeText = `${outputSize.width}\u00d7${outputSize.height}`;

  return (
    <>
      {layout.controlFrames.map((frame) => (
        <ControlFrameStack
          key={frame.unitIndex}
          frame={frame}
          genSize={genSize}
          onPickImage={onPickImage}
          onClearImage={onClearImage}
        />
      ))}

      {/* Per-unit processed slot headers (below each control frame) */}
      {layout.controlFrames.map((frame) => {
        const activeSlots = frame.processedSlots.filter((s) => {
          const u = units[s.unitIndex];
          return u && !!u.processedImage;
        });
        if (activeSlots.length === 0) return null;
        return activeSlots.map((slot, slotIdx) => {
          const imageY =
            frame.y +
            frame.height +
            ELEMENT_GAP +
            PROCESSED_HEADER_HEIGHT +
            slotIdx * (frame.height + ELEMENT_GAP + PROCESSED_HEADER_HEIGHT);
          const slotLabel =
            activeSlots.length > 1
              ? `Processed (Input ${slot.unitIndex + 2})`
              : "Processed";
          const unit = units[slot.unitIndex];
          return (
            <ProcessedFrameHeader
              key={`proc-${frame.unitIndex}-${slot.unitIndex}`}
              canvasX={frame.x}
              canvasY={imageY}
              viewport={viewport}
              frameW={frame.width}
              labelScale={labelScale}
              label={slotLabel}
              imageSrc={unit?.processedImage ?? null}
            />
          );
        });
      })}

      <InputFramePanel
        canvasX={layout.inputX}
        frameW={displayW}
        genSize={genSize}
        viewport={viewport}
        labelScale={labelScale}
        onPickImage={() => onPickImage?.(-1)}
        onClearAll={onClearAll}
      />

      <OutputFramePanel
        canvasX={layout.outputX}
        viewport={viewport}
        frameW={displayW}
        labelScale={labelScale}
        sizeText={outputSizeText}
      />

      {layout.showProcessedFrame && (
        <ProcessedFrameHeader
          canvasX={layout.processedX}
          viewport={viewport}
          frameW={displayW}
          labelScale={labelScale}
          sizeText={genSizeText}
        />
      )}
    </>
  );
}
