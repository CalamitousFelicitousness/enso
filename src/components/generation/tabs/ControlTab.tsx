import { useCallback, useMemo, useState } from "react";
import { useControlStore, unitNotSentReason } from "@/stores/controlStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import { useUiStore } from "@/stores/uiStore";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Trash2, PenLine } from "lucide-react";
import type { ControlUnitType } from "@/api/types/control";
import { UNIT_TYPE_LABELS, EXCLUSIVE_CONTROL_TYPES } from "@/api/types/control";
import { useUnifiedInputs } from "@/hooks/useUnifiedInputs";
import { useInputsAtCapacity, INPUTS_FULL_HINT } from "@/canvas/useInputsAtCapacity";
import { controlUnitPosition } from "@/lib/inputs/outline";
import { roleLabel, sentLabel } from "@/lib/inputs/text";
import type { FrameRole } from "@/lib/inputs/types";
import { useOutline } from "@/inputs/useOutline";

const UNIT_TYPE_OPTIONS: { value: ControlUnitType; label: string }[] = (
  Object.entries(UNIT_TYPE_LABELS) as [ControlUnitType, string][]
).map(([value, label]) => ({ value, label }));

function CanvasInputRows() {
  const { entries } = useOutline();
  return (
    <>
      {entries.map((entry) => (
        <div
          key={entry.frameId}
          className="flex items-center gap-1.5 p-2 rounded-md border border-border"
        >
          <span className="text-2xs text-muted-foreground font-mono w-4 shrink-0">
            {entry.position}
          </span>
          <span className="text-2xs flex-1">{roleLabel(entry.role)}</span>
          <span className="text-2xs text-muted-foreground">{sentLabel(entry.sent) ?? "empty"}</span>
        </div>
      ))}
    </>
  );
}

interface AddInputPopoverProps {
  availableSubTypes: {
    value: ControlUnitType;
    label: string;
    disabled: boolean;
  }[];
  onAddUnit: (unitType: ControlUnitType) => void;
  onAddFrame: (role: FrameRole) => void;
  unitsFull: boolean;
  framesFull: boolean;
}

const FRAME_ENTRIES: { mode: FrameRole; label: string }[] = [
  { mode: "initial", label: "Initial" },
  { mode: "reference", label: "Reference" },
];

function entryClass(disabled: boolean, indent = false) {
  return `flex w-full items-center rounded-sm px-2 py-1.5 text-sm ${indent ? "pl-4 " : ""}${disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-accent hover:text-accent-foreground"}`;
}

function AddInputPopover({
  availableSubTypes,
  onAddUnit,
  onAddFrame,
  unitsFull,
  framesFull,
}: AddInputPopoverProps) {
  const [open, setOpen] = useState(false);

  const closeAfter = useCallback((add: () => void) => {
    add();
    setOpen(false);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full" disabled={unitsFull && framesFull}>
          <Plus size={12} className="mr-1" /> Add Input
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        {FRAME_ENTRIES.map(({ mode, label }) => (
          <button
            key={mode}
            disabled={framesFull}
            title={framesFull ? INPUTS_FULL_HINT : undefined}
            className={entryClass(framesFull)}
            onClick={() => !framesFull && closeAfter(() => onAddFrame(mode))}
          >
            {label}
          </button>
        ))}
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Control</div>
        {availableSubTypes.map((st) => {
          const disabled = st.disabled || unitsFull;
          return (
            <button
              key={st.value}
              disabled={disabled}
              className={entryClass(disabled, true)}
              onClick={() => !disabled && closeAfter(() => onAddUnit(st.value))}
            >
              {st.label}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

export function ControlTab() {
  const { availableControlSubTypes } = useUnifiedInputs();
  const units = useControlStore((s) => s.units);
  const inputFramesCount = useInputStore((s) => s.frames.length);
  const addUnitWithType = useControlStore((s) => s.addUnitWithType);
  const reprocessOnGenerate = useUiStore((s) => s.reprocessOnGenerate);
  const setAutoUpdateProcessed = useUiStore((s) => s.setAutoUpdateProcessed);
  const framesFull = useInputsAtCapacity();

  const addInputFrame = useCallback((role: FrameRole) => {
    const inputs = useInputStore.getState();
    inputs.selectFrame(inputs.addFrame(role));
  }, []);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between">
        <Label
          className="text-2xs text-muted-foreground"
          title="When on, preprocessors run fresh every generation. When off, manually processed images are used as-is."
        >
          Re-process on generate
        </Label>
        <Switch checked={reprocessOnGenerate} onCheckedChange={setAutoUpdateProcessed} />
      </div>

      <div className="flex flex-col gap-1.5">
        <CanvasInputRows />
        {units.map((unit, i) => (
          <ControlUnitRow
            key={unit.id}
            index={i}
            unifiedIndex={controlUnitPosition(inputFramesCount, i)}
            inputFramesCount={inputFramesCount}
            canRemove={units.length > 1}
          />
        ))}
      </div>

      <AddInputPopover
        availableSubTypes={availableControlSubTypes}
        onAddUnit={addUnitWithType}
        onAddFrame={addInputFrame}
        unitsFull={units.length >= 10}
        framesFull={framesFull}
      />
    </div>
  );
}

interface ControlUnitRowProps {
  index: number;
  unifiedIndex: number;
  inputFramesCount: number;
  canRemove: boolean;
}

function ControlUnitRow({ index, unifiedIndex, inputFramesCount, canRemove }: ControlUnitRowProps) {
  const unit = useControlStore((s) => s.units[index]);
  const units = useControlStore((s) => s.units);
  const setUnitParam = useControlStore((s) => s.setUnitParam);
  const setUnitType = useControlStore((s) => s.setUnitType);
  const removeUnit = useControlStore((s) => s.removeUnit);
  const setImageSource = useControlStore((s) => s.setImageSource);
  const setSelectedControlFrame = useCanvasStore((s) => s.setSelectedControlFrame);

  const typeOptions = useMemo(() => {
    const otherLocked =
      units
        .filter((u, i) => i !== index && u.enabled && EXCLUSIVE_CONTROL_TYPES.has(u.unitType))
        .map((u) => u.unitType)[0] ?? null;

    return UNIT_TYPE_OPTIONS.map((opt) => ({
      ...opt,
      disabled:
        otherLocked !== null && EXCLUSIVE_CONTROL_TYPES.has(opt.value) && opt.value !== otherLocked,
    }));
  }, [units, index]);

  const imageSourceOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: "canvas", label: "Input 1 image" },
      { value: "separate", label: "Own image" },
    ];

    units.forEach((u, i) => {
      if (i !== index && u.imageSource === "separate") {
        opts.push({
          value: `unit:${i}`,
          label: `Input ${controlUnitPosition(inputFramesCount, i)} (${UNIT_TYPE_LABELS[u.unitType] ?? u.unitType}) image`,
        });
      }
    });
    return opts;
  }, [units, index, inputFramesCount]);

  const handleEditOnCanvas = useCallback(() => {
    const match = unit.imageSource.match(/^unit:(\d+)$/);
    const targetIndex = match ? Number(match[1]) : index;
    setSelectedControlFrame(targetIndex);
  }, [setSelectedControlFrame, index, unit.imageSource]);

  const showEditOnCanvas =
    unit.enabled && (unit.imageSource === "separate" || unit.imageSource.startsWith("unit:"));
  const notSent = unitNotSentReason(units, index);

  return (
    <div className="flex flex-col gap-1.5 p-2 rounded-md border border-border">
      {/* Row 1: Index + Type + Enabled + Remove */}
      <div className="flex items-center gap-1.5">
        <span className="text-2xs text-muted-foreground font-mono w-4 flex-shrink-0">
          {unifiedIndex}
        </span>
        <Combobox
          value={unit.unitType}
          onValueChange={(v) => setUnitType(index, v as ControlUnitType)}
          options={typeOptions}
          className="h-6 text-2xs flex-1"
        />

        <div className="flex items-center gap-1">
          <Label className="text-2xs text-muted-foreground">On</Label>
          <Switch
            checked={unit.enabled}
            onCheckedChange={(checked) => setUnitParam(index, "enabled", checked)}
          />
        </div>
        {canRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => removeUnit(index)}
            title="Remove input"
          >
            <Trash2 size={12} />
          </Button>
        )}
      </div>

      {/* Row 2: Image source selector + Edit on Canvas */}
      <div className="flex items-center justify-between gap-2">
        <Combobox
          value={unit.imageSource}
          onValueChange={(v) => setImageSource(index, v)}
          options={imageSourceOptions}
          className="h-6 text-2xs flex-1"
        />

        {showEditOnCanvas && (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-2xs text-amber-500 gap-1 shrink-0"
            onClick={handleEditOnCanvas}
          >
            <PenLine size={10} />
            Edit on Canvas
          </Button>
        )}
      </div>

      {/* Row 3: fixed-height status, so the row does not grow when it appears */}
      <p className="h-3 text-3xs leading-3 text-amber-500 truncate" title={notSent?.hint}>
        {notSent ? `Not sent: ${notSent.short}` : ""}
      </p>
    </div>
  );
}
