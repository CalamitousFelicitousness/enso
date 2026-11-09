import { describe, expect, it } from "vitest";
import { decideGate, gateLine, gateRefuses } from "./gate";
import { MOVING, TABS_WILL_RELOAD } from "./text";

const quiet = { tabs: 0, moving: false, actions: [] };

describe("decideGate", () => {
  it("lets a reset through when nothing else holds this browser", () => {
    const gate = decideGate(quiet);
    expect(gate).toEqual({ kind: "ok" });
    expect(gateRefuses(gate)).toBe(false);
    expect(gateLine(gate)).toBeNull();
  });

  it("refuses while other tabs are open, naming how many", () => {
    const gate = decideGate({ ...quiet, tabs: 2 });
    expect(gate).toEqual({ kind: "tabs", count: 2 });
    expect(gateRefuses(gate)).toBe(true);
    expect(gateLine(gate)).toBe("Enso is open in 2 other tabs. Close them to continue.");
    expect(gateLine({ kind: "tabs", count: 1 })).toBe(
      "Enso is open in 1 other tab. Close it to continue.",
    );
  });

  it("lets a reset through where tabs cannot be counted, and says they reload", () => {
    const gate = decideGate({ ...quiet, tabs: null });
    expect(gate).toEqual({ kind: "uncounted" });
    expect(gateRefuses(gate)).toBe(false);
    expect(gateLine(gate)).toBe(TABS_WILL_RELOAD);
  });

  it("puts what this page can end before other tabs", () => {
    expect(decideGate({ tabs: 3, moving: true, actions: ["images"] })).toEqual({
      kind: "moving",
    });
    expect(decideGate({ tabs: 3, moving: false, actions: ["video", "images"] })).toEqual({
      kind: "action",
      action: "video",
    });
    expect(gateLine({ kind: "moving" })).toBe(MOVING);
  });

  it("names the running action, with a fallback for one it does not know", () => {
    expect(gateLine({ kind: "action", action: "images" })).toBe(
      "Wait for Generate to finish sending.",
    );
    expect(gateLine({ kind: "action", action: "enhance:prompt" })).toBe(
      "Wait for the prompt enhancement to finish.",
    );
    expect(gateLine({ kind: "action", action: "something-new" })).toBe(
      "Wait for the upload to finish.",
    );
  });
});
