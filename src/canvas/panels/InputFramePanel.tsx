// Per-frame DOM chrome for the multi-Input-frame stack. Renders the panel
// above the frame (mode toggle, label, action buttons, expandable drawer
// with Info/Options KeepAlive tabs). Each panel is a sortable dnd-kit
// item under the orchestrator's vertical DndContext; Reference frames
// mount the shared ReferenceSortableOverlay for child reorder and removal.

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { GripVertical, ImagePlus, Info, Scan, Settings, Trash2, X } from "lucide-react";
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
import type { InputFrameMode, SizeSourceRef } from "@/canvas/inputFrames";
import { ReferenceSortableOverlay } from "@/canvas/ReferenceSortableOverlay";
import { SIZE_SOURCE_HINT } from "@/canvas/useSizeSource";
import { LayerPanel } from "@/components/generation/LayerPanel";
import { MaskParams } from "@/components/generation/MaskParams";
import { StrengthSlider } from "@/components/generation/StrengthSlider";
import type { InputFramePosition } from "@/canvas/inputFrameTypes";
import type { ViewportState } from "@/canvas/viewportBus";
import { INPUTS_FULL_HINT } from "@/canvas/useInputsAtCapacity";

// HTML hints for the Initial / Reference mode toggle, rendered through the
// styled Tooltip path (matte glass + <b>/<i>/<br> formatting) rather than the
// native title attribute.
const INITIAL_MODE_HINT =
  "<b>Initial</b> sends exactly what the frame shows: all visible layers " +
  "flattened at the output size, so you decide the composition and framing.<br><br>" +
  "On models with <i>Denoise</i>, it sets how far the result departs from this " +
  "image, and mask painting (inpaint) applies. Edit models such as <i>Klein</i> " +
  "and <i>Qwen-Image</i> take it as the image to edit.<br><br>" +
  "When other frames hold images too, it goes to the model as one image of the " +
  "set, without Denoise or mask.";

const REFERENCE_MODE_HINT =
  "<b>Reference</b> sends source files as they are, not flattened or cropped " +
  "to the frame. The model reads each one and composes the output itself, so " +
  "a reference can differ in shape from the output. Suits edit models such as " +
  "<i>Kontext</i>, <i>Klein</i> and <i>Qwen-Image</i>.<br><br>" +
  "Models that take a single input image generate at its size; Size shows when " +
  "that applies.<br><br>" +
  "A Reference frame can hold a grid of several images. Several inputs reach the " +
  "model together, numbered as the canvas shows them, on models that take more " +
  "than one image (<i>Qwen-Image 2.1</i>, <i>Qwen Edit Plus</i>, multi-image cloud " +
  "models). Once a model's limit is reached, the add buttons are greyed out.";

interface InputFramePanelProps {
  frame: InputFramePosition;
  /** The frame's place in the list: "Input N". */
  position: number;
  /** The images the frame sends, as a prompt numbers them ("Image 2-3");
   * null when it sends none. */
  images: string | null;
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
  /** The input frames hold as many images as the active model takes. */
  atCapacity?: boolean | undefined;
  /** Set when the image the frame size comes from is in this frame. */
  sizeSource?: SizeSourceRef | null | undefined;
}

/** Marks the input image the frame size comes from. */
function SizeSourceBadge({ onImage = false }: { onImage?: boolean }) {
  return (
    <span
      role="img"
      aria-label={SIZE_SOURCE_HINT}
      title={SIZE_SOURCE_HINT}
      className={
        onImage
          ? "grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white"
          : "shrink-0 text-muted-foreground"
      }
    >
      <Scan size={onImage ? 10 : 11} />
    </span>
  );
}

export function InputFramePanel({
  frame,
  position,
  images,
  viewport,
  labelScale,
  genSize,
  onPickImage,
  onAddReferenceChild,
  onClearFrame,
  onRemoveFrame,
  canRemove = true,
  atCapacity = false,
  sizeSource = null,
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

  const label = `Input ${position} (${isReference ? "Reference" : "Initial"})`;
  const sizeText = images ?? "empty";

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
  // A reference child is always another slot; a layer is one only on an empty frame
  const addBlocked = atCapacity && (isReference || layerCount === 0);

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
        title={
          addBlocked ? INPUTS_FULL_HINT : isReference ? "Add reference image" : "Add image layer"
        }
        onClick={isReference ? handleAddRef : handlePickImage}
        disabled={addBlocked}
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
    <KeepAliveSwitch active={`frame-${activeTab}`}>
      <KeepAlivePanel id="frame-info">
        <div className="space-y-1 text-[10px]">
          {isReference ? (
            <>
              <InfoLine label="References" value={String(refCount)} />
              <InfoLine label="Sends" value={images ?? "-"} />
            </>
          ) : (
            <>
              <InfoLine label="Layers" value={String(layerCount)} />
              <InfoLine label="Mask strokes" value={String(maskLineCount)} />
              <InfoLine
                label="Dimensions"
                value={layerCount > 0 ? `${genSize.width}×${genSize.height}` : "-"}
              />
              <InfoLine label="Sends" value={images ?? "-"} />
            </>
          )}
        </div>
      </KeepAlivePanel>
      <KeepAlivePanel id="frame-options" lazy>
        {isReference ? (
          <div className="text-[10px] text-muted-foreground italic">
            Reference frames have no extra options yet.
          </div>
        ) : (
          <div className="space-y-2">
            <StrengthSlider />
            <MaskParams />
            <LayerPanel frameId={frame.frameId} />
          </div>
        )}
      </KeepAlivePanel>
    </KeepAliveSwitch>
  );

  return (
    <>
      <FrameHeader
        mode="panel"
        color={accent}
        label={label}
        labelAdornment={
          !isReference && sizeSource && sizeSource.refId === null ? <SizeSourceBadge /> : undefined
        }
        sizeText={sizeText}
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
          mark={
            sizeSource?.refId
              ? { refId: sizeSource.refId, node: <SizeSourceBadge onImage /> }
              : null
          }
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
