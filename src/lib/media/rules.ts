// What a consumer of input pictures is known to resample them to: declared by
// the server (a rule, or none), not reported by this server, or not known yet
// (a pick remembered from before the server reported it).

import type { DeclaredSizeV2 } from "@/api/types/server";
import type { DeclaredSize, SizeRule } from "./sizeRule";

export type Declaration =
  { kind: "declared"; declared: DeclaredSize } | { kind: "unreported" } | { kind: "unknown" };

export const UNKNOWN: Declaration = { kind: "unknown" };
export const UNREPORTED: Declaration = { kind: "unreported" };

function ruleOf(wire: NonNullable<DeclaredSizeV2["rule"]>): SizeRule {
  switch (wire.kind) {
    case "area":
      return { kind: "area", area: wire.area, multiple: wire.multiple, round: wire.round };
    case "cap":
      return { kind: "cap", area: wire.area };
    case "buckets":
      return {
        kind: "buckets",
        sizes: wire.sizes.map(([width, height]) => ({ width, height })),
        fit: wire.fit,
        ratio: wire.ratio,
        aspectMultiple: wire.aspect_multiple,
      };
    case "shortest":
      return { kind: "shortest", side: wire.side };
    case "exact":
      return { kind: "exact", width: wire.width, height: wire.height };
    case "floor":
      return { kind: "floor", multiple: wire.multiple };
  }
}

/** A declaration as the server sends it, in the browser's shape. */
export function declaredSize(wire: DeclaredSizeV2): DeclaredSize {
  const limits = wire.limits ?? null;
  return {
    rule: wire.rule ? ruleOf(wire.rule) : null,
    ...(limits && (limits.min_side != null || limits.max_aspect != null)
      ? {
          limits: {
            ...(limits.min_side != null ? { minSide: limits.min_side } : {}),
            ...(limits.max_aspect != null ? { maxAspect: limits.max_aspect } : {}),
          },
        }
      : {}),
    ...(wire.output_area != null ? { outputArea: wire.output_area } : {}),
  };
}

/** What a remembered or answered field says: absent is not known yet, null is
 * a server that did not say. */
export function declarationOf(value: DeclaredSize | null | undefined): Declaration {
  if (value === undefined) return UNKNOWN;
  if (value === null) return UNREPORTED;
  return { kind: "declared", declared: value };
}

/** The rule a declaration applies, or null for none or none known. */
export function ruleIn(declaration: Declaration): SizeRule | null {
  return declaration.kind === "declared" ? declaration.declared.rule : null;
}

export function sameDeclaration(a: Declaration, b: Declaration): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
