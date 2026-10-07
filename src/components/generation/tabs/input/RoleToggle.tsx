// The four roles a frame can have, as a segmented toggle with a hint per
// role. The Input tab's inspector and the canvas docks share it.

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { frameColor } from "@/canvas/frameColors";
import { roleLabel } from "@/lib/inputs/text";
import type { FrameRole } from "@/lib/inputs/types";
import { ROLE_HINTS } from "./roleHints";

const ROLES: readonly FrameRole[] = ["initial", "reference", "control", "ipAdapter"];

interface RoleToggleProps {
  role: FrameRole;
  /** The model's image limit may refuse a switch; the store then says so. */
  onChange: (role: FrameRole) => void;
}

export function RoleToggle({ role, onChange }: RoleToggleProps) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md bg-white/5 p-0.5">
      {ROLES.map((option) => {
        const active = option === role;
        const color = frameColor(option, true);
        return (
          <Tooltip key={option}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => {
                  if (!active) onChange(option);
                }}
                className="rounded-sm px-2 py-0.5 text-[10px] font-medium transition-colors"
                style={{
                  backgroundColor: active ? `${color}26` : "transparent",
                  color: active ? color : "var(--muted-foreground)",
                  boxShadow: active ? `inset 0 0 0 1px ${color}66` : "none",
                }}
              >
                {roleLabel(option)}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span dangerouslySetInnerHTML={{ __html: ROLE_HINTS[option] }} />
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
