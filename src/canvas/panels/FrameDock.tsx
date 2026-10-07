// The DOM dock above a frame: its label and state, the role toggle, the
// action buttons and a drawer with Info and Options tabs. Each dock is a
// sortable dnd-kit item under the orchestrator's DndContext; set frames
// mount the shared ReferenceSortableOverlay for cell reorder and removal.

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { Eye, GripVertical, ImagePlus, Info, Scan, Settings, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KeepAlivePanel, KeepAliveSwitch } from "@/components/ui/keep-alive";
import { DockTab, FrameHeader, InfoLine } from "./FrameHeader";
import { frameColor } from "@/canvas/frameColors";
import { useInputStore } from "@/stores/inputStore";
import type { OutlineEntry, SizeSourcePick } from "@/lib/inputs/outline";
import {
  controlTypeLabel,
  linkedLabel,
  notSentLabel,
  positionLabel,
  roleLabel,
  sentLabel,
} from "@/lib/inputs/text";
import { composedPictures } from "@/lib/inputs/types";
import type { FramePosition } from "@/lib/inputs/layout";
import { ReferenceSortableOverlay } from "@/canvas/ReferenceSortableOverlay";
import { SIZE_SOURCE_HINT } from "@/canvas/useSizeSource";
import { FrameInspector } from "@/components/generation/tabs/input/FrameInspector";
import { RoleToggle } from "@/components/generation/tabs/input/RoleToggle";
import type { ViewportState } from "@/canvas/viewportBus";
import { INPUTS_FULL_HINT } from "@/inputs/capacity";
import { removePicture } from "@/inputs/edits";

interface FrameDockProps {
  frame: FramePosition;
  entry: OutlineEntry;
  viewport: ViewportState;
  labelScale: number;
  /** Generation size, shown as the composed frame's dimensions. */
  genSize: { width: number; height: number };
  /** Open the file picker for a composed frame. */
  onPickImage?: ((frameId: string) => void) | undefined;
  /** Open the file picker to append a cell to a set frame. */
  onAddCell?: ((frameId: string) => void) | undefined;
  onClearFrame?: ((frameId: string) => void) | undefined;
  onRemoveFrame?: ((frameId: string) => void) | undefined;
  canRemove?: boolean | undefined;
  /** The input frames hold as many images as the active model takes. */
  atCapacity?: boolean | undefined;
  /** Set when the image the frame size comes from is in this frame. */
  sizeSource?: SizeSourcePick | null | undefined;
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

export function FrameDock({
  frame,
  entry,
  viewport,
  labelScale,
  genSize,
  onPickImage,
  onAddCell,
  onClearFrame,
  onRemoveFrame,
  canRemove = true,
  atCapacity = false,
  sizeSource = null,
}: FrameDockProps) {
  const storeFrame = useInputStore((s) => s.frames.find((f) => f.id === frame.frameId));
  const switchRole = useInputStore((s) => s.switchRole);
  const movePicture = useInputStore((s) => s.movePicture);
  const setPictureVisible = useInputStore((s) => s.setPictureVisible);
  const showHiddenBySwitch = useInputStore((s) => s.showHiddenBySwitch);

  // The drag activator is the grip handle; pointer-down elsewhere in the
  // header focuses the frame. The orchestrator's PointerSensor needs 4px.
  const { attributes, listeners } = useSortable({ id: frame.frameId });

  const [activeTab, setActiveTab] = useState<"info" | "options">("info");
  const [collapsed, setCollapsed] = useState(true);

  const role = storeFrame?.role ?? entry.role;
  const isSet = frame.kind === "set";
  const cellCount = frame.kind === "set" ? frame.children.length : 0;
  const layerCount = storeFrame ? composedPictures(storeFrame).length : 0;
  const maskLineCount = storeFrame?.mask.strokes.length ?? 0;
  const unreadable = storeFrame?.pictures.filter((p) => !p.file).length ?? 0;
  const filled = entry.status === "sent" || entry.status === "notSent";
  const accent = frameColor(role, filled);

  // The control type names the role; the header has no room for both
  const roleText =
    role === "control" && storeFrame ? controlTypeLabel(storeFrame.control.type) : roleLabel(role);
  const label = `${positionLabel(entry.position)} (${roleText})`;
  // Control and IP-Adapter headers carry their state chip instead of a size
  const sizeText =
    role === "initial" || role === "reference"
      ? (sentLabel(entry.sent) ?? "empty")
      : filled || entry.status === "off"
        ? undefined
        : "empty";

  if (!storeFrame) return null;

  const frameW = frame.kind === "composed" ? frame.displayW : frame.motherW;
  const handlePickImage = () => onPickImage?.(frame.frameId);
  const handleAddCell = () => onAddCell?.(frame.frameId);
  const handleClear = () => onClearFrame?.(frame.frameId);
  const handleRemove = () => onRemoveFrame?.(frame.frameId);
  // A Reference cell is always another input image; an Initial layer is one only on an empty frame
  const countsAsInput = role === "initial" || role === "reference";
  const addBlocked = atCapacity && countsAsInput && (role === "reference" || layerCount === 0);
  const linked = role === "control" && storeFrame.link !== null;

  const handleChildReorder = (activeId: string, overId: string) => {
    const fromIndex = storeFrame.pictures.findIndex((p) => p.id === activeId);
    const toIndex = storeFrame.pictures.findIndex((p) => p.id === overId);
    if (fromIndex < 0 || toIndex < 0) return;
    movePicture(frame.frameId, fromIndex, toIndex);
  };

  // A hidden picture stays in its cell, dimmed; this is the way back.
  const cellNote = (pictureId: string) => {
    const picture = storeFrame.pictures.find((p) => p.id === pictureId);
    if (!picture || picture.visible) return null;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setPictureVisible(frame.frameId, pictureId, true);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Hidden: not sent. Click to show it again."
        className="pointer-events-auto flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-white hover:bg-black/90"
      >
        <Eye size={10} />
        Hidden
      </button>
    );
  };

  const status = (
    <>
      {entry.hiddenBySwitch > 0 && (
        <button
          type="button"
          onClick={() => showHiddenBySwitch(frame.frameId)}
          title={
            isSet
              ? "Layers of this frame's composed role, hidden while it sends a set and not sent. Click to show them as pictures of the set."
              : "Pictures hidden when this frame became composed; they are not sent. Click to show them as layers."
          }
          className="shrink-0 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-medium text-amber-400 hover:bg-amber-500/25"
        >
          {entry.hiddenBySwitch} hidden
        </button>
      )}
      {entry.notSent && (
        <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-medium text-amber-400">
          {notSentLabel(entry.notSent)}
        </span>
      )}
      {entry.linkedTo !== null && (
        <span className="shrink-0 rounded-full bg-white/5 px-1.5 text-[10px] font-medium text-muted-foreground">
          {linkedLabel(entry.linkedTo)}
        </span>
      )}
    </>
  );

  const roleToggle = (
    <RoleToggle role={role} onChange={(option) => switchRole(frame.frameId, option)} />
  );

  const actions = (
    <>
      <button
        type="button"
        title="Drag to reorder this frame"
        className="grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        style={{ cursor: "grab", touchAction: "none" }}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={12} />
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        title={
          addBlocked
            ? INPUTS_FULL_HINT
            : linked
              ? "This frame uses another frame's picture"
              : isSet
                ? "Add picture"
                : "Add image layer"
        }
        onClick={isSet ? handleAddCell : handlePickImage}
        disabled={addBlocked || linked}
      >
        <ImagePlus size={12} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        title={isSet ? "Clear all pictures" : "Clear all layers"}
        onClick={handleClear}
      >
        <Trash2 size={12} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        title={canRemove ? "Remove this frame" : "Cannot remove the only frame"}
        onClick={handleRemove}
        disabled={!canRemove}
      >
        <X size={12} />
      </Button>
    </>
  );

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

  const info = (
    <div className="space-y-1 text-[10px]">
      {isSet ? (
        <>
          <InfoLine label="Pictures" value={String(cellCount)} />
          {role === "reference" && <InfoLine label="Sends" value={sentLabel(entry.sent) ?? "-"} />}
          {role === "ipAdapter" && (
            <InfoLine label="Adapter" value={storeFrame.ipAdapter.adapter} />
          )}
          {role === "ipAdapter" && (
            <InfoLine label="Masks" value={String(storeFrame.ipAdapter.masks.length)} />
          )}
        </>
      ) : (
        <>
          <InfoLine label="Layers" value={String(layerCount)} />
          {role === "initial" && <InfoLine label="Mask strokes" value={String(maskLineCount)} />}
          {role === "control" && <InfoLine label="Model" value={storeFrame.control.model} />}
          <InfoLine
            label="Dimensions"
            value={filled ? `${genSize.width}×${genSize.height}` : "-"}
          />
          {role === "initial" && <InfoLine label="Sends" value={sentLabel(entry.sent) ?? "-"} />}
        </>
      )}
      {entry.notSent && <InfoLine label="State" value={notSentLabel(entry.notSent)} />}
      {unreadable > 0 && <InfoLine label="Could not be read" value={String(unreadable)} />}
    </div>
  );

  const options = <FrameInspector frameId={frame.frameId} withRole={false} />;

  const drawer = !collapsed && (
    <KeepAliveSwitch active={`frame-${activeTab}`}>
      <KeepAlivePanel id="frame-info">{info}</KeepAlivePanel>
      <KeepAlivePanel id="frame-options" lazy>
        {options}
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
          role === "initial" && sizeSource && sizeSource.pictureId === null ? (
            <SizeSourceBadge />
          ) : undefined
        }
        sizeText={sizeText}
        status={status}
        canvasX={frame.x}
        canvasY={frame.y}
        frameW={frameW}
        viewport={viewport}
        labelScale={labelScale}
        actions={actions}
        drawer={drawer}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        tabBar={tabBar}
        subheader={!collapsed ? roleToggle : undefined}
      />
      {frame.kind === "set" && (
        <ReferenceSortableOverlay
          cells={frame.children}
          viewport={viewport}
          onReorder={handleChildReorder}
          onRemove={(pictureId) => removePicture(frame.frameId, pictureId)}
          mark={
            sizeSource?.pictureId
              ? { refId: sizeSource.pictureId, node: <SizeSourceBadge onImage /> }
              : null
          }
          cellNote={cellNote}
        />
      )}
    </>
  );
}
