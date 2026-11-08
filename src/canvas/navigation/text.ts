import type { WheelMode } from "@/lib/viewport/wheel";

const MOD = navigator.platform.includes("Mac") ? "Ctrl/⌘" : "Ctrl";

export const WHEEL_SETTING_LABEL = "Canvas scroll wheel";
export const WHEEL_SETTING_DESCRIPTION = `What scrolling does on the canvas; pinch and ${MOD}+scroll always zoom`;
export const WHEEL_OPTIONS: { value: WheelMode; label: string }[] = [
  { value: "pan", label: "Pan" },
  { value: "zoom", label: "Zoom" },
];
