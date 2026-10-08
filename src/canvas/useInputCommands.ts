// Palette entries for the input frames: one per role, which goes to the
// first frame of that role or adds one, and the pending undo.

import { Crosshair, Image, Images, Sparkles, Wand2 } from "lucide-react";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { useInputStore } from "@/stores/inputStore";
import { useUiStore } from "@/stores/uiStore";
import { addFrame } from "@/inputs/edits";
import { processNow } from "@/inputs/processing";
import { revealFrame } from "@/inputs/reveal";

import { useOutlineEnv } from "@/inputs/useOutline";
import type { FrameRole } from "@/lib/inputs/types";

/** Show the first frame of a role in the Input tab, adding one when there is none. */
function goToRole(role: FrameRole): void {
  const first = useInputStore.getState().frames.find((f) => f.role === role);
  if (first) revealFrame(first.id);
  else addFrame(role);
  useUiStore.getState().setImagesSubTab("input");
}

export function useInputCommands(enabled: boolean): void {
  const env = useOutlineEnv();
  useRegisterCommand(
    {
      id: "inputs:process-now",
      label: "Process the inputs now",
      group: "Inputs",
      keywords: ["process", "preprocess", "map", "depth", "canny", "pose", "processor"],
      icon: Wand2,
      run: () => void processNow(env, "all", "Processing the inputs"),
    },
    enabled,
  );
  useRegisterCommand(
    {
      id: "inputs:initial",
      label: "Initial frame",
      group: "Inputs",
      keywords: ["add", "select", "go to", "input", "img2img", "init image"],
      icon: Image,
      run: () => goToRole("initial"),
    },
    enabled,
  );
  useRegisterCommand(
    {
      id: "inputs:reference",
      label: "Reference frame",
      group: "Inputs",
      keywords: ["add", "select", "go to", "input", "reference image", "edit"],
      icon: Images,
      run: () => goToRole("reference"),
    },
    enabled,
  );
  useRegisterCommand(
    {
      id: "inputs:control",
      label: "Control frame",
      group: "Inputs",
      keywords: ["add", "select", "go to", "controlnet", "control unit", "t2i"],
      icon: Crosshair,
      run: () => goToRole("control"),
    },
    enabled,
  );
  useRegisterCommand(
    {
      id: "inputs:ip-adapter",
      label: "IP-Adapter frame",
      group: "Inputs",
      keywords: ["add", "select", "go to", "ip adapter", "style reference"],
      icon: Sparkles,
      run: () => goToRole("ipAdapter"),
    },
    enabled,
  );
}
