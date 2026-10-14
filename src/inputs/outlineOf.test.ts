import { describe, expect, it } from "vitest";
import { frame, picture } from "@/lib/inputs/frames.fixture";
import type { OutlineEnv } from "@/lib/inputs/outline";
import type { Declaration } from "@/lib/media/rules";
import { outlineOf } from "./outlineOf";

const env = (reference: Declaration): OutlineEnv => ({
  requestSetsSize: true,
  sizes: { reference, ipAdapter: { kind: "unknown" }, target: { width: 1024, height: 1024 } },
});

describe("outlineOf", () => {
  it("gives a new outline when only the model's rule changes", () => {
    const frames = [frame("refs", "reference", picture("a", { width: 6000, height: 4000 }))];
    const before = outlineOf(frames, env({ kind: "declared", declared: { rule: null } }));
    const after = outlineOf(
      frames,
      env({ kind: "declared", declared: { rule: { kind: "cap", area: 1024 * 1024 } } }),
    );
    expect(before.sent[0].sentSize?.kind).toBe("whole");
    expect(after.sent[0].sentSize?.kind).toBe("fitted");
  });
});
