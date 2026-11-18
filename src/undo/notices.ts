// What the undo history tells the user: the notice of a step just made, what
// a press did, how far a wait got, and a held step's own notice. The step
// notices share one toast, so each replaces the last; waits and held steps
// keep a toast each.

import { toast } from "sonner";
import { failureText } from "@/inputs/quota";
import { OFFER_MS } from "@/lib/notices";
import { navigateToParam, type NavigateTarget } from "@/lib/navigateToParam";
import { PARAM_MAP } from "@/lib/paramMap.generated";
import { settingLabel } from "@/lib/settingLabels";
import {
  cancelledText,
  failedText,
  MODEL_LEFT,
  oneSetting,
  redoneText,
  refusedText,
  undoneText,
} from "@/lib/undo/text";
import { allSteps } from "@/lib/undo/stacks";
import type { Step } from "@/lib/undo/types";
import { useUiStore } from "@/stores/uiStore";
import type { AnnounceOptions } from "./marks";
import type { Notices, Outcome, PressKind, Undo } from "./service";

const UNDO_ID = "undo";
/** How long "Undone" and "Redone" stay up. */
const DONE_MS = 5000;

export interface UndoNotices extends Notices {
  /** Take away the notices of steps and waits that left the history. */
  readonly reconcile: () => void;
}

/** Where a one-setting step's setting is set, when one control sets it. */
function showTarget(step: Step): NavigateTarget | null {
  const one = oneSetting(step);
  if (one?.slice !== "settings") return null;
  const label = settingLabel(one.key);
  const entries = PARAM_MAP.filter((e) => e.view === "images" && e.label === label);
  if (entries.length !== 1) return null;
  const [entry] = entries;
  return entry.view === "images"
    ? { view: "images", subTab: entry.tab, section: entry.section, param: entry.param }
    : null;
}

const button = (label: string, onClick: () => void) => ({ label, onClick });

export function undoNotices(history: () => Undo | null): UndoNotices {
  /** The step the shared toast's doing notice offers to undo. */
  let doingStep: number | null = null;
  const heldShown = new Set<number>();
  const waitsShown = new Set<number>();

  const press = (kind: PressKind, only: number) => void history()?.press(kind, { only });
  const view = () => useUiStore.getState().activeNavView;

  const doing = (step: Step | null, text: string, options: AnnounceOptions) => {
    const description = options.description ?? undefined;
    const also = options.also ? button(options.also.label, options.also.onClick) : undefined;
    if (step?.held) {
      heldShown.add(step.id);
      toast(text, {
        id: `held-${step.id}`,
        description,
        duration: Infinity,
        action: button("Undo", () => history()?.release(step.id)),
        cancel: also,
      });
      return;
    }
    doingStep = step?.id ?? null;
    // sonner merges an update into the toast it replaces: every button is passed
    toast(text, {
      id: UNDO_ID,
      description,
      duration: OFFER_MS,
      action: step ? button("Undo", () => press("undo", step.id)) : undefined,
      cancel: also,
    });
  };

  const done = (text: string, description: string | undefined, step: Step, kind: PressKind) => {
    doingStep = null;
    const target = kind === "undo" && !step.held ? showTarget(step) : null;
    toast(text, {
      id: UNDO_ID,
      description,
      duration: DONE_MS,
      action: step.held
        ? undefined
        : kind === "undo"
          ? button("Redo", () => press("redo", step.id))
          : button("Undo", () => press("undo", step.id)),
      cancel: target ? button("Show", () => void navigateToParam(target)) : undefined,
    });
  };

  const pressed = (kind: PressKind, outcome: Outcome) => {
    switch (outcome.kind) {
      // a typed step changed the text in place, where the user is looking
      case "none":
      case "stale":
      case "typed":
        return;
      case "cancelled":
        doingStep = null;
        toast(outcome.name ? cancelledText(outcome.name) : "Cancelled", {
          id: UNDO_ID,
          description: undefined,
          duration: DONE_MS,
          action: undefined,
          cancel: undefined,
        });
        return;
      case "released":
        done(undoneText(outcome.step, view()), undefined, outcome.step, "undo");
        return;
      case "refused":
        toast.error(refusedText(outcome.step, kind), { description: failureText(outcome.error) });
        return;
      case "replayed": {
        const { step, failed } = outcome;
        if (failed) {
          const show = failed.dropped ? toast.error : toast.warning;
          show(failedText(step, kind, failed.dropped), { description: failureText(failed.error) });
          return;
        }
        const text = kind === "undo" ? undoneText(step, view()) : redoneText(step, view());
        done(text, outcome.gaveUp.length > 0 ? MODEL_LEFT : undefined, step, kind);
        return;
      }
    }
  };

  const progress: Notices["progress"] = (wait, _name, text) => {
    waitsShown.add(wait.id);
    toast.loading(text, {
      id: `wait-${wait.id}`,
      duration: Infinity,
      dismissible: false,
      action: button("Cancel", () => history()?.cancel(wait.id)),
    });
  };

  const reconcile = () => {
    const undo = history();
    if (!undo) return;
    const stacks = undo.stacks();
    // a running press replaces the notice with what it did
    if (doingStep !== null && !undo.busy()) {
      const onTop = Object.values(stacks.byScope).some((s) => s.undo.at(-1)?.id === doingStep);
      if (!onTop) {
        doingStep = null;
        toast.dismiss(UNDO_ID);
      }
    }
    if (heldShown.size > 0) {
      const present = new Set(allSteps(stacks).map((s) => s.id));
      for (const id of heldShown) {
        if (present.has(id)) continue;
        heldShown.delete(id);
        toast.dismiss(`held-${id}`);
      }
    }
    if (waitsShown.size > 0) {
      const open = new Set(undo.waits().map((w) => w.id));
      for (const id of waitsShown) {
        if (open.has(id)) continue;
        waitsShown.delete(id);
        toast.dismiss(`wait-${id}`);
      }
    }
  };

  return { doing, progress, pressed, reconcile };
}
