import { useMemo } from "react";
import { useControlStore } from "@/stores/controlStore";
import { UNIT_TYPE_LABELS, EXCLUSIVE_CONTROL_TYPES } from "@/api/types/control";
import type { ControlUnitType } from "@/api/types/control";

export interface UnifiedInputsResult {
  lockedControlType: ControlUnitType | null;
  availableControlSubTypes: { value: ControlUnitType; label: string; disabled: boolean }[];
}

/** Returns the lockedControlType for exclusive control-unit types (only one
 * t2i/style_transfer/ip can be active at a time) and the per-subtype availability
 * map used by the "Add Input > Control" popover. Canvas-side Input frames live
 * in canvasStore.inputFrames and are surfaced separately; this hook is now
 * control-unit-only after the multi-Input-frame rewire. */
export function useUnifiedInputs(): UnifiedInputsResult {
  const units = useControlStore((s) => s.units);

  return useMemo(() => {
    const lockedControlType =
      units
        .filter((u) => u.enabled && EXCLUSIVE_CONTROL_TYPES.has(u.unitType))
        .map((u) => u.unitType)[0] ?? null;

    const allSubTypes: ControlUnitType[] = [
      "controlnet",
      "t2i",
      "xs",
      "lite",
      "style_transfer",
      "ip",
    ];
    const availableControlSubTypes = allSubTypes.map((t) => ({
      value: t,
      label: UNIT_TYPE_LABELS[t],
      disabled:
        lockedControlType !== null && EXCLUSIVE_CONTROL_TYPES.has(t) && t !== lockedControlType,
    }));

    return { lockedControlType, availableControlSubTypes };
  }, [units]);
}
