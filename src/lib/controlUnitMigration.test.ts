import { describe, expect, it } from "vitest";
import { migrateUnitType } from "./controlUnitMigration";

describe("migrateUnitType", () => {
  it("retires the init-image unit under both of its stored names", () => {
    expect(migrateUnitType("reference")).toEqual({ unitType: "controlnet", retired: true });
    expect(migrateUnitType("asset")).toEqual({ unitType: "controlnet", retired: true });
  });

  it("never turns a stored unit into style transfer", () => {
    for (const stored of ["reference", "asset", "controlnet", "ip"]) {
      expect(migrateUnitType(stored).unitType).not.toBe("style_transfer");
    }
  });

  it("keeps current unit types as they are", () => {
    for (const stored of ["controlnet", "t2i", "xs", "lite", "style_transfer", "ip"]) {
      expect(migrateUnitType(stored)).toEqual({ unitType: stored, retired: false });
    }
  });
});
