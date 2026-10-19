import { describe, expect, it } from "vitest";
import snapshot from "@/api/types/openapi.snapshot.json";
import portable from "./portable.json";
import { portableRequest, refValues } from "./portable";

const REF = `upload:${"a".repeat(64)}`;

describe("portable.json", () => {
  it("names every generate field in exactly one list", () => {
    const fields = Object.keys(snapshot.components.schemas.GenerateParams.properties);
    const keep = new Set(portable.keep);
    const drop = new Set(portable.drop);
    expect([...keep].filter((key) => drop.has(key))).toEqual([]);
    expect([...keep, ...drop].sort()).toEqual([...fields].sort());
  });
});

describe("portableRequest", () => {
  it("keeps the kept fields and leaves the output settings behind", () => {
    const out = portableRequest({
      type: "generate",
      prompt: "a",
      steps: 20,
      save_images: true,
      priority: 1,
    });
    expect(out.request).toEqual({ type: "generate", prompt: "a", steps: 20 });
    expect(out).toMatchObject({ leftOut: [], unknown: [], notRefs: [] });
  });

  it("says what a user set that the recipe leaves out", () => {
    const out = portableRequest({
      type: "generate",
      extra: { sd_vae: "x" },
      grading_lut_file: "/luts/warm.cube",
    });
    expect(out.leftOut).toEqual(["extra", "grading_lut_file"]);
    expect(out.request).toEqual({ type: "generate", grading_lut_file: "" });
  });

  it("keeps a LUT that travels as an upload ref, and an empty extra silently", () => {
    const out = portableRequest({ type: "generate", grading_lut_file: REF, extra: {} });
    expect(out.request["grading_lut_file"]).toBe(REF);
    expect(out.leftOut).toEqual([]);
  });

  it("reports a picture field holding anything but an upload ref, by path", () => {
    const out = portableRequest({
      type: "generate",
      inputs: [REF, "data:image/png;base64,AAAA", ""],
      control: [{ image: "/abs/path.png", override: null }],
    });
    expect(out.notRefs).toEqual(["inputs[1]", "control[0].image"]);
  });

  it("reports fields neither list knows", () => {
    expect(portableRequest({ type: "generate", surprise: 1 }).unknown).toEqual(["surprise"]);
  });
});

describe("refValues", () => {
  it("walks lists and lists of objects", () => {
    const request = { ip_adapter: [{ images: [REF, "x"] }, { images: [] }] };
    expect(refValues(request, "ip_adapter[].images[]")).toEqual([
      ["ip_adapter[0].images[0]", REF],
      ["ip_adapter[0].images[1]", "x"],
    ]);
  });
});
