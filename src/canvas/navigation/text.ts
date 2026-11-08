import type { WheelMode } from "@/lib/viewport/wheel";

const MOD = navigator.platform.includes("Mac") ? "Ctrl/⌘" : "Ctrl";

export const WHEEL_SETTING_LABEL = "Canvas scroll wheel";
export const WHEEL_SETTING_DESCRIPTION = `What scrolling does on the canvas; pinch and ${MOD}+scroll always zoom`;
export const WHEEL_OPTIONS: { value: WheelMode; label: string }[] = [
  { value: "pan", label: "Pan" },
  { value: "zoom", label: "Zoom" },
];

export const FOCUS_TIP = "The view fits each frame you select (F)";
export const CANVAS_TIP = "The view stays where you move it (F)";
export const FLIP_NOTICE =
  "The view now stays where you move it. Press F to follow the selected frame again.";

export const SHOW_ALL = "Show all frames";
export const SHOW_ALL_HELD = "Showing all frames as they change; moving the view stops it";
export const ZOOM_IN = "Zoom in";
export const ZOOM_OUT = "Zoom out";
export const ZOOM_100 = "Zoom to 100%";
export const ZOOM_100_TITLE = "One image pixel per browser pixel";
export const ZOOM_FRAME = "Zoom to the current frame";
export const ZOOM_MENU = "View options";

export function zoomToFrame(name: string): string {
  return `Zoom to ${name}`;
}

/** "87%", "4.5%": whole percents from 10 up. */
export function percentText(percent: number): string {
  if (percent >= 10) return `${Math.round(percent)}%`;
  return `${Number(percent.toFixed(1))}%`;
}

export function zoomLabel(percent: number): string {
  return `Zoom ${percentText(percent)}, ${ZOOM_MENU.toLowerCase()}`;
}

/** What the pointer does on the canvas, for the cheat sheet. */
export function gestureLines(wheel: WheelMode): { gesture: string; action: string }[] {
  return [
    { gesture: "Scroll", action: wheel === "pan" ? "Pan" : "Zoom" },
    { gesture: `${MOD}+scroll or pinch`, action: "Zoom" },
    { gesture: "Shift+scroll", action: "Pan sideways" },
    { gesture: "Drag on empty canvas", action: "Pan" },
    { gesture: "Space+drag or middle drag", action: "Pan, anywhere" },
  ];
}
export const GESTURES_HEADING = "Canvas navigation";

export const TUTORIAL_TITLE = "Moving around";
export const TUTORIAL_BODY = `Scroll to move around, ${MOD}+scroll or pinch to zoom. The percentage opens Show all frames and the other views.`;
