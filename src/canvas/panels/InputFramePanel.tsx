// Per-frame DOM chrome for the multi-Input-frame stack. Renders the panel
// above the frame (mode toggle, label, action buttons, expandable drawer
// with Info/Options KeepAlive tabs). Each panel is a sortable dnd-kit
// item under the orchestrator's vertical DndContext; Reference frames
// mount the shared ReferenceSortableOverlay for child reorder and removal.

import { useMemo, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { GripVertical, ImagePlus, Info, Settings, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KeepAlivePanel, KeepAliveSwitch } from "@/components/ui/keep-alive";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { ReferenceSortableOverlay } from "@/canvas/ReferenceSortableOverlay";
import type { InputFramePosition } from "@/canvas/inputFrameTypes";

// HTML hints for the Initial / Reference mode toggle, rendered through the
// styled Tooltip path (matte glass + <b>/<i>/<br> formatting) rather than the
// native title attribute.
const INITIAL_MODE_HINT =
  "<b>Initial</b> sends the canvas as an <i>img2img</i> init image.<br><br>" +
  "All visible layers are flattened at the frame's generation size, then " +
  "denoising strength controls how far the result departs from it. Mask " +
  "painting (inpaint) applies in this mode.<br><br>Holds a single composited image.";

const REFERENCE_MODE_HINT =
  "<b>Reference</b> sends source files at their native resolution, not flattened " +
  "or resized to the frame.<br><br>Used by any model that accepts multiple image " +
  "inputs, local (<i>Klein</i>, <i>Kontext</i>, <i>Qwen Edit</i>) or cloud.<br><br>" +
  "A Reference frame can hold a grid of several images.";

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

export function InputFramePanel({
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
  const reorderReferenceInFrame = useCanvasStore((s) => s.reorderReferenceInFrame);
  const removeReferenceFromFrame = useCanvasStore((s) => s.removeReferenceFromFrame);

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

  // The overlay speaks ids; map them to this frame's reference indices.
  const handleChildReorder = (activeId: string, overId: string) => {
    if (!storeFrame) return;
    const fromIndex = storeFrame.references.findIndex((r) => r.id === activeId);
    const toIndex = storeFrame.references.findIndex((r) => r.id === overId);
    if (fromIndex < 0 || toIndex < 0) return;
    reorderReferenceInFrame(frame.frameId, fromIndex, toIndex);
  };

  // Compact Mode toggle pill (Initial / Reference). Rendered in the
  // FrameHeader's subheader slot, above the Info/Options tab bar.
  const modeToggle = (
    <div className="inline-flex items-center gap-0.5 rounded-md bg-white/5 p-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => handleModeSwitch("initial")}
            className="rounded-sm px-2.5 py-0.5 text-[10px] font-medium transition-colors"
            style={{
              backgroundColor: !isReference ? `${INPUT_COLOR_ACTIVE}26` : "transparent",
              color: !isReference ? INPUT_COLOR_ACTIVE : "var(--muted-foreground)",
              boxShadow: !isReference ? `inset 0 0 0 1px ${INPUT_COLOR_ACTIVE}66` : "none",
            }}
          >
            Initial
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <span dangerouslySetInnerHTML={{ __html: INITIAL_MODE_HINT }} />
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => handleModeSwitch("reference")}
            className="rounded-sm px-2.5 py-0.5 text-[10px] font-medium transition-colors"
            style={{
              backgroundColor: isReference ? `${INPUT_COLOR_REFERENCE}26` : "transparent",
              color: isReference ? INPUT_COLOR_REFERENCE : "var(--muted-foreground)",
              boxShadow: isReference ? `inset 0 0 0 1px ${INPUT_COLOR_REFERENCE}66` : "none",
            }}
          >
            Reference
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <span dangerouslySetInnerHTML={{ __html: REFERENCE_MODE_HINT }} />
        </TooltipContent>
      </Tooltip>
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

  // Drawer tabs + content. FrameHeader wraps the tabBar slot in its own
  // flex row with px-3 padding, and the drawer slot in p-3, so we pass
  // naked content here to avoid double-wrapping (which had caused an 8px
  // indent mismatch with the subheader) and skip an extra border-t (which
  // had cluttered the divider between tab bar and tab content).
  const tabBar = !collapsed && (
    <>
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
    </>
  );

  const drawer = !collapsed && (
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
        <div className="text-[10px] text-muted-foreground italic">
          {isReference
            ? "Reference frames have no extra options yet."
            : "Layer + mask params will live here."}
        </div>
      </KeepAlivePanel>
    </KeepAliveSwitch>
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
        subheader={!collapsed ? modeToggle : undefined}
      />
      {/* Per-reference-child overlays: the shared sortable overlay hosts
       * the X-button hover affordance and dnd-kit drag-reorder, wired to
       * this frame's slice of canvasStore. */}
      {frame.kind === "reference" && (
        <ReferenceSortableOverlay
          cells={frame.children}
          viewport={viewport}
          onReorder={handleChildReorder}
          onRemove={(refId) => removeReferenceFromFrame(frame.frameId, refId)}
        />
      )}
    </>
  );
}

// ── InfoLine ─────────────────────────────────────────────────────────

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </div>
  );
}
