// The accent colour of each kind of frame, shared by the Konva layers and the DOM docks.

import type { FrameRole } from "@/lib/inputs/types";

export const INPUT_COLOR_ACTIVE = "#4ade80";
export const INPUT_COLOR_REFERENCE = "#38bdf8";
export const INPUT_COLOR_INACTIVE = "#6b7280";
export const OUTPUT_COLOR = "#60a5fa";
export const CONTROL_COLOR = "#f59e0b";
export const IP_ADAPTER_COLOR = "#fb7185";
export const PROCESSED_COLOR = "#c084fc";
/** Pictures whose bytes could not be read. */
export const UNREADABLE_COLOR = "#f87171";

/** A frame's accent: its role's colour, or the inactive grey while an Initial frame is empty. */
export function frameColor(role: FrameRole, filled: boolean): string {
  switch (role) {
    case "initial":
      return filled ? INPUT_COLOR_ACTIVE : INPUT_COLOR_INACTIVE;
    case "reference":
      return INPUT_COLOR_REFERENCE;
    case "control":
      return CONTROL_COLOR;
    case "ipAdapter":
      return IP_ADAPTER_COLOR;
  }
}
