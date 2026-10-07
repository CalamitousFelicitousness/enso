// Adds a frame of a role at the end of the list and selects it. Input roles
// are greyed once the model's image limit is reached; a Control frame can
// only be of the type the other Control frames send.

import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useInputsAtCapacity } from "@/canvas/useInputsAtCapacity";
import { INPUTS_FULL_HINT } from "@/inputs/capacity";
import { addFrame } from "@/inputs/edits";
import { controlTypeLabel, roleLabel } from "@/lib/inputs/text";
import { CONTROL_TYPES, type ControlType, type FrameRole } from "@/lib/inputs/types";

const INPUT_ROLES: FrameRole[] = ["initial", "reference"];

function entryClass(disabled: boolean, indent = false) {
  return `flex w-full items-center rounded-sm px-2 py-1.5 text-sm ${indent ? "pl-4 " : ""}${disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-accent hover:text-accent-foreground"}`;
}

export function AddFrameMenu({ lockedType }: { lockedType: ControlType | null }) {
  const framesFull = useInputsAtCapacity();
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
        {INPUT_ROLES.map((role) => (
          <button
            key={role}
            disabled={framesFull}
            title={framesFull ? INPUTS_FULL_HINT : undefined}
            className={entryClass(framesFull)}
            onClick={() => !framesFull && closeAfter(() => addFrame(role))}
          >
            {roleLabel(role)}
          </button>
        ))}
        <button
          className={entryClass(false)}
          onClick={() => closeAfter(() => addFrame("ipAdapter"))}
        >
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
              onClick={() => !disabled && closeAfter(() => addFrame("control", type))}
            >
              {controlTypeLabel(type)}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
