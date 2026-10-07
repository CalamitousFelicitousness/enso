import { useMemo } from "react";
import { useInputStore } from "@/stores/inputStore";
import { useUiStore } from "@/stores/uiStore";
import {
  resolveSizeSource,
  sizeSourcePick,
  sizeSourceState,
  type SizeSourcePick,
  type SizeSourceState,
} from "@/lib/inputs/outline";
import { addressLabel, roleLabel } from "@/lib/inputs/text";
import { outlineOf } from "@/inputs/outlineOf";

export const SIZE_SOURCE_HINT = "Output size is based on this image";

export interface SizeSourceOption {
  value: string;
  label: string;
}

/** A SizeSourcePick as one string, for store selectors and select values. */
function pickValue(pick: SizeSourcePick): string {
  return `${pick.frameId}/${pick.pictureId ?? ""}`;
}

export function parseSizeSourceValue(value: string): SizeSourcePick {
  const [frameId, pictureId] = value.split("/");
  return { frameId, pictureId: pictureId || null };
}

// Selectors return strings, so mask strokes and layer moves re-render nothing

/** Every input image that can set the frame size, as the Size from list shows it. */
export function useSizeSourceOptions(): SizeSourceOption[] {
  const rows = useInputStore((s) =>
    outlineOf(s.frames)
      .sent.map((input) => {
        const label = `${addressLabel(input.address)} · ${roleLabel(input.role)} · ${input.width}×${input.height}`;
        return `${pickValue(sizeSourcePick(input))}\t${label}`;
      })
      .join("\n"),
  );
  return useMemo(
    () =>
      rows
        ? rows.split("\n").map((row) => {
            const [value, label] = row.split("\t");
            return { value, label };
          })
        : [],
    [rows],
  );
}

/** The input image that sets the frame size, as a Size from value; "" when the
 * canvas holds no input image. */
export function useSizeSourceValue(): string {
  return useInputStore((s) => {
    const source = resolveSizeSource(outlineOf(s.frames).sent, s.sizeSource);
    return source ? pickValue(sizeSourcePick(source)) : "";
  });
}

/** The size source to mark on the canvas: only while Fit is on and more than
 * one input image could set the size. */
export function useSizeSourceMark(sentCount: number): SizeSourcePick | null {
  const fit = useUiStore((s) => s.autoFitFrame);
  const value = useSizeSourceValue();
  return useMemo(
    () => (fit && sentCount > 1 && value ? parseSizeSourceValue(value) : null),
    [fit, sentCount, value],
  );
}

/** Where the frame size comes from, for the Size section's notice. */
export function useSizeSourceState(): SizeSourceState["kind"] {
  return useInputStore((s) => sizeSourceState(outlineOf(s.frames).sent, s.sizeSource).kind);
}
