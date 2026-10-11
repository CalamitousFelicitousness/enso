import { describe, expect, it } from "vitest";
import { loadsModel } from "./requests";

describe("loadsModel", () => {
  it("names the model each local video type loads", () => {
    expect(loadsModel("video", { engine: "WAN Video", model: "WAN 2.2 A14B T2V" })).toEqual({
      model: "WAN 2.2 A14B T2V",
    });
    expect(loadsModel("video", { engine: "WAN Video", model: "" })).toEqual({ model: "WAN Video" });
    expect(loadsModel("framepack", { variant: "FramePack I2V HY" })).toEqual({
      model: "FramePack I2V HY",
    });
    expect(loadsModel("ltx", { model: "LTXVideo 2.5 22B T2V Distilled" })).toEqual({
      model: "LTXVideo 2.5 22B T2V Distilled",
    });
  });

  it("loads nothing for a cloud video or an image job, and names none it cannot read", () => {
    expect(loadsModel("cloud_video", { model: "veo-3" })).toBeNull();
    expect(loadsModel("generate", { prompt: "x" })).toBeNull();
    expect(loadsModel("ltx", null)).toEqual({ model: null });
  });
});
