import type { ControlUnitType } from "@/api/types/control";

/** Unit type for a stored control-unit snapshot. Snapshots name the retired
 * init-image unit "reference" ("asset" in older ones); its image never reached a
 * pipeline, so it comes back as a disabled ControlNet unit in the same position,
 * keeping the image that unit:N links resolve through. */
export function migrateUnitType(stored: string): { unitType: ControlUnitType; retired: boolean } {
  if (stored === "reference" || stored === "asset") {
    return { unitType: "controlnet", retired: true };
  }
  return { unitType: stored as ControlUnitType, retired: false };
}
