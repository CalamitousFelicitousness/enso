// Per-frame DOM chrome for the multi-Input-frame stack. Renders the panel
// above the frame (mode toggle, label, action buttons, expandable drawer
// with Info/Options KeepAlive tabs) plus per-reference-child X-button
// hover overlays in Reference mode.
//
// Named `InputFramePanelV2` internally to avoid a collision with the
// legacy `InputFramePanel` in `src/canvas/ControlFramePanel.tsx`; exported
// here as the bare `InputFramePanel`. After deletes the legacy
// function, this file's local symbol can be renamed back.

import { useMemo, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { GripVertical, ImagePlus, Info, Settings, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KeepAlivePanel, KeepAliveSwitch } from "@/components/ui/keep-alive";
import {
  DockTab,
  FrameHeader,
  INPUT_COLOR_ACTIVE,
  INPUT_COLOR_INACTIVE,
  INPUT_COLOR_REFERENCE,
} from "@/canvas/ControlFramePanel";
import { useCanvasStore } from "@/stores/canvasStore";
import type { ImageLayer } from "@/stores/canvasStore";
import type { InputFrameMode } from "@/canvas/inputFrames";
import type { InputFramePosition, ReferenceChildPosition } from "@/canvas/inputFrameTypes";

interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

interface InputFramePanelProps {
  frame: InputFramePosition;
  /** Global wire index of the frame's first slot, or null when the frame
   * is empty (no visible image in Initial, no references in Reference).
   * Drives the "Input N (mode)" label - the orchestrator computes this
   * once for the whole stack via enumerateWireSlots. */
  wireIndex: number | null;
  viewport: ViewportState;
  labelScale: number;
  /** Generation size (display in the size text for Initial frames). */
  genSize: { width: number; height: number };
  /** Click handler for the empty-state "drop image" target / ImagePlus
   * action - opens the file picker scoped to this frame. */
  onPickImage?: ((frameId: string) => void) | undefined;
  /** Reference mode: open file picker to append a new reference child. */
  onAddReferenceChild?: ((frameId: string) => void) | undefined;
  /** Clear all content in the frame (layers + mask + references). */
  onClearFrame?: ((frameId: string) => void) | undefined;
  /** Remove the frame from the input column. Disabled when only one frame
   * remains (canRemove === false). */
  onRemoveFrame?: ((frameId: string) => void) | undefined;
  canRemove?: boolean | undefined;
}

function InputFramePanelV2({
  frame,
  wireIndex,
  viewport,
  labelScale,
  genSize,
  onPickImage,
  onAddReferenceChild,
  onClearFrame,
  onRemoveFrame,
  canRemove = true,
}: InputFramePanelProps) {
  const storeFrame = useCanvasStore((s) => s.inputFrames.find((f) => f.id === frame.frameId));
  const setFrameMode = useCanvasStore((s) => s.setFrameMode);

  // dnd-kit Sortable for whole-frame vertical reorder. The drag activator
  // is the GripVertical handle inside the panel header - pointer-down on
  // the rest of the header focuses the frame instead. Activation distance
  // is set on the orchestrator's PointerSensor (4px) so a stray click
  // doesn't trigger drag.
  const { attributes, listeners } = useSortable({ id: frame.frameId });

  const [activeTab, setActiveTab] = useState<"info" | "options">("info");
  const [collapsed, setCollapsed] = useState(true);

  // Derive values from storeFrame with defensive fallbacks so all hooks
  // below can run unconditionally; the early return on missing storeFrame
  // comes after the hook list.
  const isReference = storeFrame?.mode === "reference";
  const refCount = storeFrame?.references.length ?? 0;
  const visibleImages =
    storeFrame?.layers.filter((l): l is ImageLayer => l.type === "image" && l.visible) ?? [];
  const layerCount = visibleImages.length;
  const maskLineCount = storeFrame?.maskLines.length ?? 0;

  const accent = isReference
    ? INPUT_COLOR_REFERENCE
    : layerCount > 0
      ? INPUT_COLOR_ACTIVE
      : INPUT_COLOR_INACTIVE;

  // Label format mirrors the legacy "Input 1 (Initial)" / "Input 1 (Reference)"
  // pattern, with wireIndex sourced from the global slot enumeration and
  // a "K images" suffix for Reference frames to surface child count up front.
  const label = useMemo(() => {
    const numberPart = wireIndex != null ? `Input ${wireIndex}` : "Input (empty)";
    if (isReference) {
      const suffix = refCount > 0 ? `, ${refCount} ${refCount === 1 ? "image" : "images"}` : "";
      return `${numberPart} (Reference${suffix})`;
    }
    return `${numberPart} (Initial)`;
  }, [wireIndex, isReference, refCount]);

  const sizeText = useMemo(() => {
    if (isReference) return refCount > 0 ? `${refCount} ref` : "";
    if (layerCount === 0) return "";
    return `${genSize.width}×${genSize.height}`;
  }, [isReference, refCount, layerCount, genSize.width, genSize.height]);

  if (!storeFrame) return null;

  // Frame width for the FrameHeader projection - Initial uses displayW,
  // Reference uses motherW. Both are display-space.
  const canvasX = frame.x;
  const canvasY = frame.y;
  const frameW = frame.kind === "initial" ? frame.displayW : frame.motherW;

  const handleModeSwitch = (mode: InputFrameMode) => {
    if (mode === storeFrame.mode) return;
    setFrameMode(frame.frameId, mode);
  };
  const handlePickImage = () => onPickImage?.(frame.frameId);
  const handleAddRef = () => onAddReferenceChild?.(frame.frameId);
  const handleClear = () => onClearFrame?.(frame.frameId);
  const handleRemove = () => onRemoveFrame?.(frame.frameId);

  // ── Mode toggle pill (Initial / Reference) ───────────────────────────
  const modeToggle = (
    <div className="flex items-center gap-0.5 rounded-md bg-white/5 p-0.5">
      <button
        onClick={() => handleModeSwitch("initial")}
        className="rounded-sm px-2 py-0.5 text-[10px] font-medium transition-colors"
        style={{
          backgroundColor: !isReference ? `${INPUT_COLOR_ACTIVE}26` : "transparent",
          color: !isReference ? INPUT_COLOR_ACTIVE : "var(--muted-foreground)",
          boxShadow: !isReference ? `inset 0 0 0 1px ${INPUT_COLOR_ACTIVE}66` : "none",
        }}
        title="Initial: canvas flattened at frame size, used as img2img target with denoising."
      >
        Initial
      </button>
      <button
        onClick={() => handleModeSwitch("reference")}
        className="rounded-sm px-2 py-0.5 text-[10px] font-medium transition-colors"
        style={{
          backgroundColor: isReference ? `${INPUT_COLOR_REFERENCE}26` : "transparent",
          color: isReference ? INPUT_COLOR_REFERENCE : "var(--muted-foreground)",
          boxShadow: isReference ? `inset 0 0 0 1px ${INPUT_COLOR_REFERENCE}66` : "none",
        }}
        title="Reference: source files sent at native resolution. Grid of N references for multi-image cloud workflows."
      >
        Reference
      </button>
    </div>
  );

  // ── Header action buttons ────────────────────────────────────────────
  const dragHandleEl = (
    <button
      type="button"
      title="Drag to reorder this Input frame"
      className="grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
      style={{ cursor: "grab", touchAction: "none" }}
      {...attributes}
      {...listeners}
    >
      <GripVertical size={12} />
    </button>
  );

  const actions = (
    <>
      {dragHandleEl}
      {modeToggle}
      <Button
        variant="ghost"
        size="icon-xs"
        title={isReference ? "Add reference image" : "Add image layer"}
        onClick={isReference ? handleAddRef : handlePickImage}
      >
        <ImagePlus size={12} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        title={isReference ? "Clear all references" : "Clear all layers"}
        onClick={handleClear}
      >
        <Trash2 size={12} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        title={canRemove ? "Remove this input frame" : "Cannot remove the only input frame"}
        onClick={handleRemove}
        disabled={!canRemove}
      >
        <X size={12} />
      </Button>
    </>
  );

  // ── Drawer tabs + content ────────────────────────────────────────────
  const tabBar = !collapsed && (
    <div className="flex items-center gap-1 border-t border-white/5 px-2 py-1">
      <DockTab
        active={activeTab === "info"}
        label="Info"
        icon={Info}
        accent={accent}
        onClick={() => setActiveTab("info")}
      />
      <DockTab
        active={activeTab === "options"}
        label="Options"
        icon={Settings}
        accent={accent}
        onClick={() => setActiveTab("options")}
      />
    </div>
  );

  const drawer = !collapsed && (
    <div className="border-t border-white/5 px-3 py-2">
      <KeepAliveSwitch active={activeTab}>
        <KeepAlivePanel id="info">
          <div className="space-y-1 text-[10px]">
            {isReference ? (
              <>
                <InfoLine label="References" value={String(refCount)} />
                <InfoLine label="Wire" value={wireIndex != null ? `image ${wireIndex}+` : "-"} />
              </>
            ) : (
              <>
                <InfoLine label="Layers" value={String(layerCount)} />
                <InfoLine label="Mask strokes" value={String(maskLineCount)} />
                <InfoLine
                  label="Dimensions"
                  value={layerCount > 0 ? `${genSize.width}×${genSize.height}` : "-"}
                />
                <InfoLine label="Wire" value={wireIndex != null ? `image ${wireIndex}` : "-"} />
              </>
            )}
          </div>
        </KeepAlivePanel>
        <KeepAlivePanel id="options" lazy>
          {/* Phase 6 placeholder: Initial mode would host the denoise slider
            + LayerPanel(frameId) + MaskParams(frameId) here. Those legacy
            components don't accept frameId yet - Phase 9 plumbs the prop
            through. */}
          <div className="text-[10px] text-muted-foreground italic">
            {isReference
              ? "Reference frames have no extra options yet."
              : "Layer + mask params will live here (Phase 9 wiring)."}
          </div>
        </KeepAlivePanel>
      </KeepAliveSwitch>
    </div>
  );

  return (
    <>
      <FrameHeader
        mode="panel"
        color={accent}
        label={label}
        sizeText={sizeText || undefined}
        canvasX={canvasX}
        canvasY={canvasY}
        frameW={frameW}
        viewport={viewport}
        labelScale={labelScale}
        actions={actions}
        drawer={drawer}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        tabBar={tabBar}
      />
      {/* Per-reference-child X-button hover overlays. Mount only for
       * Reference frames; one absolute-positioned <div> per child. The
       * wrapper has pointer-events: none so it doesn't block clicks on
       * the Konva cell; pointer-events: auto only applies on the X
       * button itself so the rest of the cell stays interactive. */}
      {frame.kind === "reference" &&
        frame.children.map((child) => (
          <ReferenceChildOverlay
            key={child.refId}
            frameId={frame.frameId}
            child={child}
            viewport={viewport}
          />
        ))}
    </>
  );
}

export { InputFramePanelV2 as InputFramePanel };

// ── InfoLine ─────────────────────────────────────────────────────────

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </div>
  );
}

// ── Per-reference-child overlay ───────────────────────────────────────

interface ReferenceChildOverlayProps {
  frameId: string;
  child: ReferenceChildPosition;
  viewport: ViewportState;
}

function ReferenceChildOverlay({ frameId, child, viewport }: ReferenceChildOverlayProps) {
  const removeReferenceFromFrame = useCanvasStore((s) => s.removeReferenceFromFrame);

  const style = useMemo<React.CSSProperties>(() => {
    const left = child.x * viewport.scale + viewport.x;
    const top = child.y * viewport.scale + viewport.y;
    const width = child.displayW * viewport.scale;
    const height = child.displayH * viewport.scale;
    return {
      position: "absolute",
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      pointerEvents: "none",
    };
  }, [child.x, child.y, child.displayW, child.displayH, viewport.scale, viewport.x, viewport.y]);

  return (
    <div style={style} className="group">
      <button
        type="button"
        onClick={() => removeReferenceFromFrame(frameId, child.refId)}
        title="Remove reference"
        className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
        style={{ pointerEvents: "auto" }}
      >
        <X size={10} />
      </button>
    </div>
  );
}
