import { describe, expect, it } from "vitest";
import { firstRunState } from "./firstRun";
import { LOCAL } from "./names";

describe("firstRunState", () => {
  it("is a first run when nothing of Enso is kept", () => {
    expect(firstRunState(null, [])).toBe("first");
    expect(firstRunState(null, ["modalZoom", "other-app"])).toBe("first");
  });

  it("does not count the reset record or the marker's own key", () => {
    expect(firstRunState(null, [LOCAL.reset, LOCAL.profile])).toBe("first");
  });

  it("is an existing profile when Enso kept something before the marker existed", () => {
    expect(firstRunState(null, [LOCAL.ui])).toBe("existing");
  });

  it("is marked whenever the marker holds anything, a bad value included", () => {
    expect(firstRunState("1794000000000", [])).toBe("marked");
    expect(firstRunState("not a time", [LOCAL.ui])).toBe("marked");
  });
});
