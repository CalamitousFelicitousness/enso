// Whether a reset may be asked for now, and the line that says why not.

import { actionRunningText, MOVING, otherTabsText, TABS_WILL_RELOAD } from "./text";

export type ResetGate =
  | { kind: "ok" }
  /** The browser cannot count tabs; the others are told to reload instead. */
  | { kind: "uncounted" }
  | { kind: "tabs"; count: number }
  | { kind: "moving" }
  | { kind: "action"; action: string };

export interface GateFacts {
  /** Other tabs holding their inputs; null where the browser cannot count them. */
  tabs: number | null;
  /** The move to the server is running. */
  moving: boolean;
  /** Ids of the actions sending now. */
  actions: readonly string[];
}

/** What this page can end comes first, then what only other tabs can. */
export function decideGate(facts: GateFacts): ResetGate {
  if (facts.moving) return { kind: "moving" };
  const action = facts.actions[0];
  if (action !== undefined) return { kind: "action", action };
  if (facts.tabs === null) return { kind: "uncounted" };
  if (facts.tabs > 0) return { kind: "tabs", count: facts.tabs };
  return { kind: "ok" };
}

export function gateRefuses(gate: ResetGate): boolean {
  return gate.kind === "tabs" || gate.kind === "moving" || gate.kind === "action";
}

/** The dialog's reason line; null when there is nothing to say. */
export function gateLine(gate: ResetGate): string | null {
  switch (gate.kind) {
    case "ok":
      return null;
    case "uncounted":
      return TABS_WILL_RELOAD;
    case "tabs":
      return otherTabsText(gate.count);
    case "moving":
      return MOVING;
    case "action":
      return actionRunningText(gate.action);
  }
}
