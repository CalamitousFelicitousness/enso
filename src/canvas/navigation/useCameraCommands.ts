import { useLayoutEffect, useMemo } from "react";
import { Fullscreen, Maximize2, ScanSearch, ZoomIn, ZoomOut } from "lucide-react";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { useShortcut } from "@/hooks/useShortcut";
import { fitTargets, type FitFrame } from "@/lib/viewport/insets";
import { useChromeBoxes } from "./chrome";
import type { Camera, Follow } from "./camera";
import { SHOW_ALL, ZOOM_100, ZOOM_FRAME, ZOOM_IN, ZOOM_OUT } from "./text";

interface CameraCommandOptions {
  camera: Camera;
  /** What the fits target, with the chrome the camera has measured. */
  frames: readonly FitFrame[];
  /** The stage scale of one image pixel per CSS pixel. */
  unit: number;
  /** The frame the camera follows in Focus mode. */
  current: string;
  /** The stored state the first fit depends on is in. */
  ready: boolean;
  /** What the camera follows once it is ready. */
  initialFollow: () => Follow;
  /** Keys and palette entries register only while the canvas is on screen. */
  visible: boolean;
  /** Prefix for this canvas's palette ids. */
  name: string;
  /** Zoom to the current frame (Images). */
  frameCommands?: boolean;
}

const PAN_STEP = 0.1;

/** The fits, the zoom and pan keys and the palette entries of one canvas. */
export function useCameraCommands({
  camera,
  frames,
  unit,
  current,
  ready,
  initialFollow,
  visible,
  name,
  frameCommands = false,
}: CameraCommandOptions) {
  const chrome = useChromeBoxes(camera.chrome);
  const targets = useMemo(() => fitTargets(frames, chrome), [frames, chrome]);

  useLayoutEffect(() => camera.setUnit(unit), [camera, unit]);
  useLayoutEffect(() => camera.setTargets(targets, current), [camera, targets, current]);
  useLayoutEffect(() => {
    if (ready) camera.arm(initialFollow());
  }, [camera, ready, initialFollow]);

  const keys = visible;
  useShortcut("canvas-zoom-in", () => camera.zoomStep(1), keys);
  useShortcut("canvas-zoom-in-eq", () => camera.zoomStep(1), keys);
  useShortcut("canvas-zoom-out", () => camera.zoomStep(-1), keys);
  useShortcut("canvas-zoom-100", () => camera.zoomToUnit(), keys);
  useShortcut("canvas-show-all", () => camera.showAll(), keys);
  useShortcut("canvas-zoom-frame", () => camera.fitFrame(), keys && frameCommands);
  // Scrolling left shows what is to the left: the content moves right
  useShortcut("canvas-pan-left", () => camera.panStep(PAN_STEP, 0), keys);
  useShortcut("canvas-pan-right", () => camera.panStep(-PAN_STEP, 0), keys);
  useShortcut("canvas-pan-up", () => camera.panStep(0, PAN_STEP), keys);
  useShortcut("canvas-pan-down", () => camera.panStep(0, -PAN_STEP), keys);

  useRegisterCommand(
    {
      id: `${name}:zoom-in`,
      label: ZOOM_IN,
      group: "Canvas",
      keywords: ["magnify", "closer", "enlarge"],
      icon: ZoomIn,
      shortcutId: "canvas-zoom-in",
      run: () => camera.zoomStep(1),
    },
    visible,
  );
  useRegisterCommand(
    {
      id: `${name}:zoom-out`,
      label: ZOOM_OUT,
      group: "Canvas",
      keywords: ["further", "smaller", "shrink"],
      icon: ZoomOut,
      shortcutId: "canvas-zoom-out",
      run: () => camera.zoomStep(-1),
    },
    visible,
  );
  useRegisterCommand(
    {
      id: `${name}:zoom-100`,
      label: ZOOM_100,
      group: "Canvas",
      keywords: ["actual size", "actual pixels", "1:1", "one to one"],
      icon: ScanSearch,
      shortcutId: "canvas-zoom-100",
      run: () => camera.zoomToUnit(),
    },
    visible,
  );
  useRegisterCommand(
    {
      id: `${name}:show-all`,
      label: SHOW_ALL,
      group: "Canvas",
      keywords: ["reset view", "reset zoom", "overview", "home", "zoom to fit", "fit all"],
      icon: Fullscreen,
      shortcutId: "canvas-show-all",
      run: () => camera.showAll(),
    },
    visible,
  );
  useRegisterCommand(
    {
      id: `${name}:zoom-frame`,
      label: ZOOM_FRAME,
      group: "Canvas",
      keywords: ["zoom to selection", "fit frame", "focus frame"],
      icon: Maximize2,
      shortcutId: "canvas-zoom-frame",
      run: () => camera.fitFrame(),
    },
    visible && frameCommands,
  );
}
