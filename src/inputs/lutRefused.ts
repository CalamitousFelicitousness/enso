import { toast } from "sonner";
import type { LutRefused } from "@/lib/lut";
import { OPEN_COLOR_GRADING, OPEN_COLOR_TAB } from "@/lib/media/text";
import { openLutSection } from "@/lib/navigateToParam";

/** Say a LUT cannot be sent, with the way to its section. */
export function sayLutRefused(err: LutRefused): void {
  toast.warning(err.message, {
    action: {
      label: err.where === "images" ? OPEN_COLOR_TAB : OPEN_COLOR_GRADING,
      onClick: () => openLutSection(err.where),
    },
  });
}
