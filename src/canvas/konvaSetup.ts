import Konva from "konva";

// Left button only. The default of [0, 1] lets a middle-drag drag a node out
// from under the pan gesture.
const DRAG_BUTTONS = [0];
Konva.dragButtons = DRAG_BUTTONS;

/** Space held: a left-drag pans the canvas, so no node starts a drag. */
export function setPanKey(held: boolean): void {
  Konva.dragButtons = held ? [] : DRAG_BUTTONS;
}
