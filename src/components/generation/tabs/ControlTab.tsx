// The Input tab: one row per frame of the input document, as the canvas
// numbers them, with the On switch and remove beside each; settings live in
// the frame's dock on the canvas.

import { useCallback, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useInputStore } from "@/stores/inputStore";
import { useUiStore } from "@/stores/uiStore";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useInputsAtCapacity, INPUTS_FULL_HINT } from "@/canvas/useInputsAtCapacity";
import { useOutline } from "@/inputs/useOutline";
import type { OutlineEntry } from "@/lib/inputs/outline";
import {
  controlTypeLabel,
  linkedLabel,
  notSentLabel,
  problemText,
  roleLabel,
  sentLabel,
} from "@/lib/inputs/text";
import { CONTROL_TYPES, type ControlType, type FrameRole } from "@/lib/inputs/types";

/** One word for the row: what the frame does in the next request. */
function statusText(entry: OutlineEntry): string {
  switch (entry.status) {
    case "off":
      return "off";
    case "empty":
      return "empty";
    case "notSent":
      return entry.notSent ? notSentLabel(entry.notSent) : "not sent";
    case "sent":
      return sentLabel(entry.sent) ?? "sent";
  }
}

function FrameRow({ entry, canRemove }: { entry: OutlineEntry; canRemove: boolean }) {
  const frame = useInputStore((s) => s.frames.find((f) => f.id === entry.frameId));
  const selected = useInputStore((s) => s.selectedFrameId === entry.frameId);
  const setEnabled = useInputStore((s) => s.setEnabled);
  const removeFrame = useInputStore((s) => s.removeFrame);
  const selectFrame = useInputStore((s) => s.selectFrame);
  if (!frame) return null;

  const roleText =
    frame.role === "control" ? controlTypeLabel(frame.control.type) : roleLabel(frame.role);
  const status =
    entry.linkedTo !== null
      ? `${statusText(entry)}, ${linkedLabel(entry.linkedTo)}`
      : statusText(entry);

  return (
    <div
      className={`flex items-center gap-1.5 p-2 rounded-md border ${selected ? "border-primary/50" : "border-border"}`}
    >
      <button
        type="button"
        onClick={() => selectFrame(entry.frameId)}
        title="Select this frame on the canvas"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <span className="text-2xs text-muted-foreground font-mono w-4 shrink-0">
          {entry.position}
        </span>
        <span className="text-2xs flex-1 truncate">{roleText}</span>
        <span className="text-2xs text-muted-foreground truncate">{status}</span>
      </button>
      <div className="flex items-center gap-1">
        <Label className="text-2xs text-muted-foreground">On</Label>
        <Switch
          checked={frame.enabled}
          onCheckedChange={(checked) => setEnabled(entry.frameId, checked)}
        />
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => removeFrame(entry.frameId)}
        disabled={!canRemove}
        title={canRemove ? "Remove this frame" : "Cannot remove the only frame"}
      >
        <Trash2 size={12} />
      </Button>
    </div>
  );
}

const INPUT_ROLES: { role: FrameRole; label: string }[] = [
  { role: "initial", label: roleLabel("initial") },
  { role: "reference", label: roleLabel("reference") },
];

function entryClass(disabled: boolean, indent = false) {
  return `flex w-full items-center rounded-sm px-2 py-1.5 text-sm ${indent ? "pl-4 " : ""}${disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-accent hover:text-accent-foreground"}`;
}

interface AddInputPopoverProps {
  /** The control type the frames already send; the others cannot join it. */
  lockedType: ControlType | null;
  /** The input frames hold as many images as the model takes. */
  framesFull: boolean;
  onAdd: (role: FrameRole, type?: ControlType) => void;
}

function AddInputPopover({ lockedType, framesFull, onAdd }: AddInputPopoverProps) {
  const [open, setOpen] = useState(false);
  const closeAfter = useCallback((add: () => void) => {
    add();
    setOpen(false);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <Plus size={12} className="mr-1" /> Add Input
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        {INPUT_ROLES.map(({ role, label }) => (
          <button
            key={role}
            disabled={framesFull}
            title={framesFull ? INPUTS_FULL_HINT : undefined}
            className={entryClass(framesFull)}
            onClick={() => !framesFull && closeAfter(() => onAdd(role))}
          >
            {label}
          </button>
        ))}
        <button className={entryClass(false)} onClick={() => closeAfter(() => onAdd("ipAdapter"))}>
          {roleLabel("ipAdapter")}
        </button>
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          {roleLabel("control")}
        </div>
        {CONTROL_TYPES.map((type) => {
          const disabled = lockedType !== null && type !== lockedType;
          return (
            <button
              key={type}
              disabled={disabled}
              title={
                disabled
                  ? `Control frames must share one type; ${controlTypeLabel(lockedType)} is in use`
                  : undefined
              }
              className={entryClass(disabled, true)}
              onClick={() => !disabled && closeAfter(() => onAdd("control", type))}
            >
              {controlTypeLabel(type)}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

export function ControlTab() {
  const outline = useOutline();
  const reprocessOnGenerate = useUiStore((s) => s.reprocessOnGenerate);
  const setAutoUpdateProcessed = useUiStore((s) => s.setAutoUpdateProcessed);
  const framesFull = useInputsAtCapacity();
  const lockedType = outline.controls[0]?.settings.type ?? null;
  const problems = outline.problems.map(problemText).join(" ");

  const addFrame = useCallback((role: FrameRole, type?: ControlType) => {
    const inputs = useInputStore.getState();
    const id = inputs.addFrame(role);
    if (type) inputs.patchControl(id, { type });
    inputs.selectFrame(id);
  }, []);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between">
        <Label
          className="text-2xs text-muted-foreground"
          title="When on, processors run fresh every generation. When off, processed maps are sent as they are."
        >
          Re-process on generate
        </Label>
        <Switch checked={reprocessOnGenerate} onCheckedChange={setAutoUpdateProcessed} />
      </div>

      <div className="flex flex-col gap-1.5">
        {outline.entries.map((entry) => (
          <FrameRow key={entry.frameId} entry={entry} canRemove={outline.entries.length > 1} />
        ))}
      </div>

      {/* Fixed height, so the list does not move when a problem appears */}
      <p className="h-3 text-3xs leading-3 text-amber-500 truncate" title={problems}>
        {problems}
      </p>

      <AddInputPopover lockedType={lockedType} framesFull={framesFull} onAdd={addFrame} />
    </div>
  );
}
