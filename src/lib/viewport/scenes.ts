// What the Images minimap draws for each frame: its box, colour and names,
// from the layout and the outline.

import { OUTPUT_COLOR, frameColor } from "@/lib/inputs/colors";
import { getOrderedFrames, parseFrameId, type FrameId } from "@/lib/inputs/frames";
import type { FrameLayout } from "@/lib/inputs/layout";
import type { OutlineEntry } from "@/lib/inputs/outline";
import { frameRoleLabel, positionLabel, roleLabel } from "@/lib/inputs/text";
import type { Frame } from "@/lib/inputs/types";
import type { Box } from "./types";

export interface MinimapFrame {
  id: FrameId;
  box: Box;
  color: string;
  /** "1", "2", ..., "Out": drawn on the box. */
  short: string;
  /** "Input 1, Reference", "Output": its title and accessible name. */
  name: string;
  off: boolean;
  current: boolean;
}

export const OUTPUT_SHORT = "Out";
export const OUTPUT_NAME = "Output";

/** Every frame the layout places, in the order the arrows step through them. */
export function imagesScene(
  layout: FrameLayout,
  entries: readonly OutlineEntry[],
  frames: readonly Pick<Frame, "id" | "role" | "control">[],
  current: FrameId,
): MinimapFrame[] {
  const byId = new Map(entries.map((e) => [e.frameId, e]));
  const roles = new Map(frames.map((f) => [f.id, f]));
  return getOrderedFrames(layout).flatMap(({ id, ...box }): MinimapFrame[] => {
    const parsed = parseFrameId(id);
    if (parsed.kind === "output") {
      return [
        {
          id,
          box,
          color: OUTPUT_COLOR,
          short: OUTPUT_SHORT,
          name: OUTPUT_NAME,
          off: false,
          current: current === id,
        },
      ];
    }
    const entry = byId.get(parsed.id);
    if (!entry) return [];
    const frame = roles.get(entry.frameId);
    const role = frame ? frameRoleLabel(frame) : roleLabel(entry.role);
    return [
      {
        id,
        box,
        color: frameColor(entry.role, entry.status === "sent" || entry.status === "notSent"),
        short: String(entry.position),
        name: `${positionLabel(entry.position)}, ${role}`,
        off: entry.status === "off",
        current: current === id,
      },
    ];
  });
}
