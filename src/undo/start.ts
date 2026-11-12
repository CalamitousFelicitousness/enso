// Starts the undo history: the slices, the recorder and the service, and hands
// it the declarations. In development `window.__undo` shows the stacks, each
// step as it closes and every settle write.

import { useEffect } from "react";
import { OFFER_MS } from "@/lib/notices";
import { DEFAULT_SIZE_MULTIPLE, snapSize } from "@/lib/sizeCompute";
import type { Draft, Scope, Step } from "@/lib/undo/types";
import { revealFrame } from "@/inputs/reveal";
import { keepingSize } from "@/inputs/sizeSync";
import { useGenerationStore } from "@/stores/generationStore";
import { inputsReady, useInputStore } from "@/stores/inputStore";
import { lutsSettled } from "@/stores/lutStore";
import { useModelCapabilityStore } from "@/stores/modelCapabilityStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useUiStore } from "@/stores/uiStore";
import { windowGestures } from "./gesture";
import { install } from "./marks";
import type { RecorderLog, SettleWrite } from "./recorder";
import type { ReplayHooks } from "./replay";
import { createUndo, type Undo } from "./service";
import { fitSlice } from "./slices/fit";
import { img2imgSlice } from "./slices/img2img";
import { inputsSlice } from "./slices/inputs";
import { lutSlice } from "./slices/lut";
import { modelSlice } from "./slices/model";
import { presetsSlice } from "./slices/presets";
import { scriptsSlice } from "./slices/scripts";
import { settingsSlice } from "./slices/settings";

/** Scopes whose own document the first build records. */
const RECORDED: ReadonlySet<Scope> = new Set<Scope>(["images", "gallery", "shared"]);

/** The selected model's size multiple as it was last seen loaded: the canvas
 * store's follows an effect, too late for a replay. */
function selectedMultiple(): number {
  const model = useModelSelectionStore.getState().activeModel;
  if (model?.source !== "local") return DEFAULT_SIZE_MULTIPLE;
  const record = useModelCapabilityStore.getState().byTitle[model.title];
  return record?.size_multiple ?? DEFAULT_SIZE_MULTIPLE;
}

const hooks: ReplayHooks = {
  around: keepingSize,
  settle: () => {
    const { width, height, setParams } = useGenerationStore.getState();
    const multiple = selectedMultiple();
    const snapped = { width: snapSize(width, multiple), height: snapSize(height, multiple) };
    if (snapped.width !== width || snapped.height !== height) setParams(snapped);
  },
  show: (step) => {
    const patch = step.patches.find((p) => p.slice === "inputs");
    if (patch?.kind !== "list") return;
    const touched = new Set(Object.keys(patch.items));
    const { frames, selectedFrameId } = useInputStore.getState();
    // the selection the step restored stays when the step touched that frame
    const shown =
      frames.find((f) => f.id === selectedFrameId && touched.has(f.id)) ??
      frames.find((f) => touched.has(f.id));
    if (shown) revealFrame(shown.id);
  },
};

const KEEP = 200;

/** What the development inspector shows. */
export interface Inspector {
  readonly undo: Undo;
  readonly steps: Draft[];
  readonly settles: (SettleWrite & { readonly at: number })[];
  readonly declared: { readonly kind: string; readonly origin: string; readonly at: number }[];
  /** The stacks as ids and names. */
  readonly summary: () => Record<string, { undo: string[]; redo: string[] }>;
}

const describe = (step: Step) =>
  `#${step.id} ${step.name.kind}${step.name.args ? ` ${JSON.stringify(step.name.args)}` : ""} [${step.view}] ${[...step.patches, ...step.riders].map((p) => p.slice).join("+") || "command"}`;

function devLog(): { log: RecorderLog; inspector: (undo: Undo) => Inspector } {
  const steps: Draft[] = [];
  const settles: Inspector["settles"] = [];
  const declared: Inspector["declared"] = [];
  const keep = <T>(list: T[], item: T) => {
    list.push(item);
    if (list.length > KEEP) list.shift();
  };
  return {
    log: {
      closed: (drafts) => {
        for (const draft of drafts) keep(steps, draft);
      },
      settle: (write) => {
        keep(settles, { ...write, at: performance.now() });
        const keys = Object.keys(
          write.patch.kind === "keys" ? write.patch.after : write.patch.items,
        );
        console.debug("[undo] settle write", write.slice, keys, write.notes);
      },
      declared: (kind, origin) => keep(declared, { kind, origin, at: performance.now() }),
    },
    inspector: (undo) => ({
      undo,
      steps,
      settles,
      declared,
      summary: () =>
        Object.fromEntries(
          Object.entries(undo.stacks().byScope).map(([scope, stack]) => [
            scope,
            { undo: stack.undo.map(describe), redo: stack.redo.map(describe) },
          ]),
        ),
    }),
  };
}

let running: { readonly undo: Undo; readonly stop: () => void } | null = null;

/** Start the history once; later calls return the one running. */
export function startUndo(): Undo {
  if (running) return running.undo;
  const gestures = windowGestures();
  const dev = import.meta.env.DEV ? devLog() : null;
  const undo = createUndo({
    gestures,
    view: () => useUiStore.getState().activeNavView,
    recorded: RECORDED,
    hooks,
    holdMs: OFFER_MS,
    ...(dev && { log: dev.log }),
  });
  for (const slice of [
    settingsSlice(),
    img2imgSlice(),
    fitSlice(),
    scriptsSlice(),
    modelSlice(),
    presetsSlice(),
  ]) {
    undo.add(slice);
  }
  // both read their state from IndexedDB: their arrival is no one's step
  let stopped = false;
  void lutsSettled().then(() => {
    if (!stopped) undo.add(lutSlice());
  });
  void inputsReady().then(() => {
    if (!stopped) undo.add(inputsSlice());
  });
  const uninstall = install(undo.marks);
  if (dev) (window as { __undo?: Inspector }).__undo = dev.inspector(undo);
  running = {
    undo,
    stop: () => {
      stopped = true;
      uninstall();
      undo.stop();
      gestures.stop();
      running = null;
    },
  };
  return undo;
}

/** Mount once in AppShell. */
export function useUndoHistory(): void {
  useEffect(() => {
    startUndo();
  }, []);
}

if (import.meta.hot) import.meta.hot.dispose(() => running?.stop());
