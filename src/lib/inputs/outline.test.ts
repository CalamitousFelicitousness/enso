import { describe, expect, it } from "vitest";
import { frame, layer, picture } from "./frames.fixture";
import {
  computeOutline,
  firstComposite,
  loneReference,
  outlineEntry,
  problemPositions,
  resolveSizeSource,
  sentAsImage,
  sizeSourcePick,
  sizeSourceState,
  type Outline,
  type ProcessingEnv,
  type SizeSourcePick,
} from "./outline";
import { defaultControl, defaultIpAdapter } from "./reducers";
import {
  addressLabel,
  fixLabel,
  mapsWord,
  problemText,
  sendAsImageLabel,
  sentLabel,
  statusWord,
  unreadableText,
} from "./text";
import type { ControlSettings, Frame, Picture } from "./types";

/** Each sent picture as "Image 2 <- frame/picture", a composite as "frame/*". */
const sends = (outline: Outline) =>
  outline.sent.map((s) => `${addressLabel(s.address)} <- ${s.frameId}/${s.pictureId ?? "*"}`);

describe("computeOutline", () => {
  it("numbers pictures in frame order, then picture order within a frame", () => {
    const outline = computeOutline([
      frame("man", "initial", layer("m")),
      frame("pets", "reference", picture("dog"), picture("cat")),
      frame("hat", "initial", layer("h")),
    ]);
    expect(sends(outline)).toEqual([
      "Image 1 <- man/*",
      "Image 2 <- pets/dog",
      "Image 3 <- pets/cat",
      "Image 4 <- hat/*",
    ]);
  });

  it("gives every frame a position and only sent pictures a number", () => {
    const outline = computeOutline([
      frame("empty", "initial"),
      frame("hidden", "initial", layer("x", { visible: false })),
      frame("none", "reference"),
      frame("pets", "reference", picture("dog")),
      frame("man", "initial", layer("m")),
    ]);
    expect(outline.entries.map((e) => `${e.position}:${e.status}`)).toEqual([
      "1:empty",
      "2:empty",
      "3:empty",
      "4:sent",
      "5:sent",
    ]);
    expect(sends(outline)).toEqual(["Image 1 <- pets/dog", "Image 2 <- man/*"]);
  });

  it("sends an Initial frame's visible layers as one picture, sized by the bottom one", () => {
    const f = frame(
      "f",
      "initial",
      layer("off", { visible: false, width: 10, height: 10 }),
      layer("base", { width: 1336, height: 744 }),
      layer("top", { width: 50, height: 50 }),
    );
    const [only] = computeOutline([f]).sent;
    expect(only).toMatchObject({ pictureId: null, width: 1336, height: 744 });
  });

  it("takes no number for a frame that is off, a hidden picture, or one a switch hid", () => {
    const outline = computeOutline([
      { ...frame("off", "reference", picture("a")), enabled: false },
      frame(
        "refs",
        "reference",
        picture("b", { visible: false }),
        picture("c"),
        picture("d", { visible: false, hiddenBySwitch: true }),
      ),
    ]);
    expect(outline.entries.map((e) => e.status)).toEqual(["off", "sent"]);
    expect(sends(outline)).toEqual(["Image 1 <- refs/c"]);
    expect(outline.entries[1].hiddenBySwitch).toBe(1);
  });

  it("lists a Reference frame's cells, sent or not, without those a switch hid", () => {
    const cells = (f: Frame) =>
      computeOutline([f]).entries[0].slots.map((s) => `${s.pictureId}:${s.address?.n ?? "-"}`);
    const refs = frame(
      "refs",
      "reference",
      picture("a"),
      picture("b", { visible: false }),
      picture("c"),
      picture("d", { visible: false, hiddenBySwitch: true }),
    );
    expect(cells(refs)).toEqual(["a:1", "b:-", "c:2"]);
    expect(cells({ ...refs, enabled: false })).toEqual(["a:-", "b:-", "c:-"]);
    expect(cells(frame("paint", "initial", layer("x")))).toEqual([]);
  });

  it("counts each kind of media on its own", () => {
    const outline = computeOutline([
      frame("one", "reference", picture("a")),
      frame(
        "mixed",
        "reference",
        picture("b"),
        picture("clip", { media: "video" }),
        picture("voice", { media: "audio" }),
      ),
    ]);
    expect(sends(outline)).toEqual([
      "Image 1 <- one/a",
      "Image 2 <- mixed/b",
      "Video 1 <- mixed/clip",
      "Audio 1 <- mixed/voice",
    ]);
    expect(sentLabel(outline.entries[1].sent)).toBe("Image 2, Video 1, Audio 1");
  });

  it("keeps the number of a picture whose bytes are gone and flags it", () => {
    const outline = computeOutline([
      frame("refs", "reference", picture("a", { file: null }), picture("b")),
      frame("paint", "initial", layer("base"), layer("lost", { file: null })),
      frame("fine", "initial", layer("ok")),
    ]);
    expect(outline.sent.map((s) => s.unreadable)).toEqual([true, false, true, false]);
    expect(unreadableText(outline.entries)).toBe(
      "A stored picture in Inputs 1-2 could not be read. Replace or remove it.",
    );
    expect(unreadableText(outline.entries.slice(2))).toBeNull();
  });

  it("marks a sent composite whose frame carries a mask", () => {
    const masked: Frame = {
      ...frame("f", "initial", layer("a")),
      mask: { objects: [], strokes: [{ points: [0, 0, 1, 1], strokeWidth: 2, tool: "brush" }] },
    };
    expect(computeOutline([masked]).sent[0].masked).toBe(true);
    expect(computeOutline([frame("g", "initial", layer("a"))]).sent[0].masked).toBe(false);
  });
});

describe("labels", () => {
  const outline = computeOutline([
    frame("refs", "reference", picture("a"), picture("b"), picture("c")),
    frame("empty", "initial"),
    frame("paint", "initial", layer("x")),
  ]);

  it("names what a frame sends by the numbers a prompt uses", () => {
    expect(outline.entries.map((e) => sentLabel(e.sent))).toEqual(["Image 1-3", null, "Image 4"]);
  });

  it("finds a frame's entry", () => {
    expect(outlineEntry(outline, "paint")?.position).toBe(3);
    expect(outlineEntry(outline, "gone")).toBeUndefined();
  });
});

describe("firstComposite", () => {
  const ids = (frames: Frame[]) => firstComposite(frames)?.map((p) => p.id) ?? null;

  it("is the first Initial frame that sends a picture, as its visible layers", () => {
    const frames = [
      frame("refs", "reference", picture("r")),
      frame("empty", "initial", layer("hidden", { visible: false })),
      { ...frame("off", "initial", layer("x")), enabled: false },
      frame("paint", "initial", layer("base"), layer("off", { visible: false }), layer("top")),
    ];
    expect(ids(frames)).toEqual(["base", "top"]);
    expect(ids(frames.slice(0, 3))).toBeNull();
  });

  it("refuses a composite with a layer that could not be read", () => {
    const frames = [frame("paint", "initial", layer("base"), layer("lost", { file: null }))];
    expect(() => firstComposite(frames)).toThrow(
      "A stored picture in Input 1 could not be read. Replace or remove it.",
    );
  });
});

describe("loneReference", () => {
  it("is the Reference picture that is the only thing sent", () => {
    const refs = frame("refs", "reference", picture("a", { width: 700, height: 500 }));
    expect(loneReference(computeOutline([refs, frame("e", "initial")]))).toMatchObject({
      pictureId: "a",
      width: 700,
      height: 500,
    });
    expect(loneReference(computeOutline([refs, frame("p", "initial", layer("x"))]))).toBeNull();
    expect(loneReference(computeOutline([frame("p", "initial", layer("x"))]))).toBeNull();
    expect(loneReference(computeOutline([]))).toBeNull();
  });
});

describe("resolveSizeSource", () => {
  const man = frame("man", "initial", layer("m", { width: 1336, height: 744 }));
  const refs = frame(
    "refs",
    "reference",
    picture("dog", { width: 1024, height: 1536 }),
    picture("cat", { width: 800, height: 600 }),
  );

  const sized = (frames: Frame[], pick: SizeSourcePick | null) => {
    const source = resolveSizeSource(computeOutline(frames).sent, pick);
    return source ? `${source.address.n}:${source.width}x${source.height}` : null;
  };

  it("defaults to the first picture sent", () => {
    expect(sized([man, refs], null)).toBe("1:1336x744");
    expect(sized([refs, man], null)).toBe("1:1024x1536");
  });

  it("keeps a picked picture wherever it moves", () => {
    const cat = { frameId: "refs", pictureId: "cat" };
    expect(sized([man, refs], cat)).toBe("3:800x600");
    expect(sized([refs, man], cat)).toBe("2:800x600");
    expect(sized([refs, man], { frameId: "man", pictureId: null })).toBe("3:1336x744");
  });

  it("keeps the size once the pick is gone while other pictures are sent", () => {
    expect(sized([man, refs], { frameId: "refs", pictureId: "gone" })).toBeNull();
    expect(sized([refs], { frameId: "man", pictureId: null })).toBeNull();
    const { sent } = computeOutline([refs]);
    expect(sizeSourceState(sent, { frameId: "man", pictureId: null })).toEqual({
      kind: "lost",
      pick: { frameId: "man", pictureId: null },
    });
    expect(sizeSourceState(sent, null)).toMatchObject({ kind: "first" });
    expect(sizeSourceState(sent, { frameId: "refs", pictureId: "cat" })).toMatchObject({
      kind: "picked",
      input: { pictureId: "cat" },
    });
    expect(sizeSourceState([], { frameId: "man", pictureId: null })).toEqual({ kind: "none" });
  });

  it("follows a pick across its frame's role switch", () => {
    const asSlots = frame("man", "reference", picture("seed", { width: 1336, height: 744 }));
    expect(sized([refs, asSlots], { frameId: "man", pictureId: null })).toBe("3:1336x744");
    const asPaint = frame("refs", "initial", layer("paint", { width: 512, height: 512 }));
    expect(sized([man, asPaint], { frameId: "refs", pictureId: "cat" })).toBe("2:512x512");
  });

  it("names the source it resolved to", () => {
    const { sent } = computeOutline([man, refs]);
    for (const source of sent) {
      expect(resolveSizeSource(sent, sizeSourcePick(source))).toBe(source);
    }
  });

  it("finds nothing when nothing is sent", () => {
    expect(sized([frame("a", "initial"), frame("b", "reference")], null)).toBeNull();
  });
});

describe("control and IP-Adapter frames", () => {
  const unit = (
    id: string,
    patch: Partial<ControlSettings> = {},
    ...pictures: Picture[]
  ): Frame => ({
    ...frame(id, "control", ...pictures),
    control: { ...defaultControl(), model: "Xinsir", ...patch },
  });
  const adapter = (id: string, ...pictures: Picture[]): Frame => ({
    ...frame(id, "ipAdapter", ...pictures),
    ipAdapter: { ...defaultIpAdapter(), adapter: "Base SDXL" },
  });

  it("sends a Control frame's own picture to the control model, never numbered", () => {
    const outline = computeOutline([
      unit("edges", {}, layer("e")),
      frame("man", "initial", layer("m")),
    ]);
    expect(sends(outline)).toEqual(["Image 1 <- man/*"]);
    expect(outline.controls.map((c) => `${c.position}:${c.frameId}<-${c.sourceFrameId}`)).toEqual([
      "1:edges<-edges",
    ]);
    expect(outline.entries[0]).toMatchObject({
      status: "sent",
      notSent: null,
      slots: [],
      linkedTo: null,
    });
  });

  it("sends the linked frame's composite, whatever that frame's switch says", () => {
    const man = { ...frame("man", "initial", layer("m")), enabled: false };
    const outline = computeOutline([man, { ...unit("edges"), link: { frameId: "man" } }]);
    expect(outline.sent).toEqual([]);
    expect(outline.controls.map((c) => c.sourceFrameId)).toEqual(["man"]);
    expect(outline.entries[1]).toMatchObject({ status: "sent", linkedTo: 1 });
  });

  it("says why a linked frame sends nothing", () => {
    const statuses = (frames: Frame[]) =>
      computeOutline(frames).entries.map((e) => `${e.status}${e.notSent ? `:${e.notSent}` : ""}`);
    expect(statuses([{ ...unit("edges"), link: { frameId: "gone" } }])).toEqual([
      "notSent:linkBroken",
    ]);
    expect(
      statuses([
        frame("refs", "reference", picture("a")),
        { ...unit("edges"), link: { frameId: "refs" } },
      ]),
    ).toEqual(["sent", "notSent:linkBroken"]);
    expect(
      statuses([frame("man", "initial"), { ...unit("edges"), link: { frameId: "man" } }]),
    ).toEqual(["empty", "notSent:noPicture"]);
    expect(statuses([unit("edges")])).toEqual(["empty"]);
  });

  it("needs a model unless the type or the checkpoint brings one", () => {
    const none = unit("edges", { model: "None" }, layer("e"));
    expect(computeOutline([none]).entries[0]).toMatchObject({
      status: "notSent",
      notSent: "noModel",
    });
    expect(computeOutline([none], { controlUnified: true }).entries[0].status).toBe("sent");
    const style = unit("style", { model: "None", type: "style_transfer" }, layer("s"));
    expect(computeOutline([style]).entries[0].status).toBe("sent");
  });

  it("sends an IP-Adapter frame's pictures as a set, never numbered", () => {
    const outline = computeOutline([
      adapter("faces", picture("a"), picture("b", { visible: false })),
      frame("man", "initial", layer("m")),
    ]);
    expect(sends(outline)).toEqual(["Image 1 <- man/*"]);
    expect(outline.ipAdapters.map((a) => a.pictureIds)).toEqual([["a"]]);
    expect(outline.entries[0].slots.map((s) => [s.pictureId, s.address])).toEqual([
      ["a", null],
      ["b", null],
    ]);
    expect(computeOutline([adapter("empty")]).entries[0].status).toBe("empty");
    expect(computeOutline([frame("plain", "ipAdapter", picture("a"))]).entries[0]).toMatchObject({
      status: "notSent",
      notSent: "noModel",
    });
  });

  it("reports control frames of more than one type", () => {
    const outline = computeOutline([
      unit("a", {}, layer("x")),
      unit("b", { type: "t2i" }, layer("y")),
      unit("c", { type: "t2i" }, layer("z")),
    ]);
    expect(outline.problems).toEqual([
      {
        code: "mixedControlTypes",
        frames: [
          { position: 1, type: "controlnet" },
          { position: 2, type: "t2i" },
          { position: 3, type: "t2i" },
        ],
      },
    ]);
    expect(problemText(outline.problems[0])).toBe(
      "Control frames must share one type: Input 1 (ControlNet), Input 2 (T2I-Adapter), Input 3 (T2I-Adapter).",
    );
    expect(computeOutline([unit("a", {}, layer("x")), unit("b", {}, layer("y"))]).problems).toEqual(
      [],
    );
  });

  it("flags a control picture whose bytes are gone", () => {
    const outline = computeOutline([
      unit("edges", {}, layer("e", { file: null })),
      unit("depth", {}, layer("d")),
    ]);
    expect(outline.controls.map((c) => c.unreadable)).toEqual([true, false]);
  });
});

describe("problems", () => {
  const unit = (id: string, type: ControlSettings["type"], ...pictures: Picture[]): Frame => ({
    ...frame(id, "control", ...pictures),
    control: { ...defaultControl(), model: "Xinsir", type },
  });
  const codes = (outline: Outline) => outline.problems.map((p) => p.code);

  it("reports more images than the model takes, naming the frames past the limit", () => {
    const frames = [
      frame("man", "initial", layer("m")),
      frame("pets", "reference", picture("dog"), picture("cat")),
      frame("hat", "initial", layer("h")),
    ];
    const outline = computeOutline(frames, { maxInputImages: 2 });
    expect(outline.problems).toMatchObject([
      { code: "tooManyImages", limit: 2, sent: 4, positions: [2, 3] },
    ]);
    const problem = outline.problems[0];
    expect(
      problem.code === "tooManyImages" &&
        problem.over.map((o) => `${o.position}/${o.pictureId ?? "*"}:${o.address.n}`),
    ).toEqual(["2/cat:3", "3/*:4"]);
    expect(outline.entries.map((e) => e.blockedBy)).toEqual([
      [],
      ["tooManyImages"],
      ["tooManyImages"],
    ]);
    expect(problemText(outline.problems[0])).toBe(
      "This model takes up to 2 input images; the frames send 4.",
    );
    expect(fixLabel(outline.problems[0])).toBe("Turn off Inputs 2-3");
    expect(codes(computeOutline(frames, { maxInputImages: 4 }))).toEqual([]);
    expect(codes(computeOutline(frames, { maxInputImages: null }))).toEqual([]);
    expect(codes(computeOutline(frames))).toEqual([]);
  });

  it("offers to hide set pictures past the limit when no composite is past it", () => {
    const frames = [frame("refs", "reference", picture("a"), picture("b"), picture("c"))];
    const outline = computeOutline(frames, { maxInputImages: 1 });
    expect(outline.problems[0]).toMatchObject({ code: "tooManyImages", positions: [1] });
    expect(fixLabel(outline.problems[0])).toBe("Hide Image 2-3");
  });

  it("goes out as a set with several images, or a lone Reference where the request sets the size", () => {
    const refs = frame("refs", "reference", picture("a"));
    expect(computeOutline([refs]).set).toBe(false);
    expect(computeOutline([refs], { requestSetsSize: true }).set).toBe(true);
    expect(
      computeOutline([frame("man", "initial", layer("m"))], { requestSetsSize: true }).set,
    ).toBe(false);
    expect(computeOutline([refs, frame("man", "initial", layer("m"))]).set).toBe(true);
  });

  it("reports a mask and control frames beside a set", () => {
    const masked: Frame = {
      ...frame("man", "initial", layer("m")),
      mask: { objects: [], strokes: [{ points: [0, 0, 1, 1], strokeWidth: 4, tool: "brush" }] },
    };
    const refs = frame("refs", "reference", picture("a"));
    const outline = computeOutline([masked, refs, unit("edges", "controlnet", layer("e"))]);
    expect(outline.problems).toEqual([
      { code: "maskWithSet", positions: [1], images: 2 },
      { code: "controlWithSet", positions: [3], images: 2 },
    ]);
    expect(problemText(outline.problems[0])).toBe(
      "The mask on Input 1 cannot be sent with several input images.",
    );
    expect(problemText(outline.problems[1])).toBe(
      "Input 3 cannot be sent with several input images.",
    );
    expect(fixLabel(outline.problems[0])).toBe("Clear the mask");
    expect(fixLabel(outline.problems[1])).toBe("Turn off Input 3");
    // a lone Reference sent at the set size is a set too
    const lone = computeOutline([refs, unit("edges", "controlnet", layer("e"))], {
      requestSetsSize: true,
    });
    expect(problemText(lone.problems[0])).toBe(
      "Input 2 cannot be sent with a Reference image sent at the size you set.",
    );
    // without a set, neither is a problem
    expect(codes(computeOutline([masked, unit("edges", "controlnet", layer("e"))]))).toEqual([]);
  });

  it("reports unreadable pictures wherever they are sent", () => {
    const outline = computeOutline([
      frame("man", "initial", layer("m", { file: null })),
      unit("edges", "controlnet", layer("e", { file: null })),
      frame("fine", "reference", picture("ok")),
    ]);
    expect(outline.problems).toEqual([
      { code: "unreadable", positions: [1, 2] },
      { code: "controlWithSet", positions: [2], images: 2 },
    ]);
    expect(problemText(outline.problems[0])).toBe(
      "A stored picture in Inputs 1-2 could not be read. Replace or remove it.",
    );
    expect(unreadableText(outline.entries)).toBe(
      "A stored picture in Input 1 could not be read. Replace or remove it.",
    );
  });

  it("names the positions of every problem", () => {
    const outline = computeOutline([
      unit("edges", "controlnet", layer("e")),
      unit("depth", "t2i", layer("d")),
    ]);
    expect(outline.problems.map(problemPositions)).toEqual([[1, 2]]);
    expect(fixLabel(outline.problems[0])).toBe("Turn off Input 2");
  });
});

describe("maps", () => {
  const canny = { id: "Canny", params: { low_threshold: 50 } };
  const processing = (patch: Partial<ProcessingEnv> = {}): ProcessingEnv => ({
    revision: "1",
    defaults: { Canny: { low_threshold: 100, high_threshold: 200 } },
    current: new Set(),
    lookedUp: new Set(),
    pending: new Map(),
    failed: new Map(),
    cloud: false,
    stamp: 0,
    frame: { width: 1024, height: 768 },
    target: { width: 1024, height: 768 },
    ...patch,
  });
  const processed = (f: Frame): Frame => ({ ...f, processor: canny });
  const control = (id: string, ...pictures: Picture[]): Frame => ({
    ...frame(id, "control", ...pictures),
    control: { ...defaultControl(), model: "Xinsir" },
  });

  it("names each frame's processor, also while it is off, and none where the role takes none", () => {
    const off: Frame = { ...processed(frame("off", "initial", layer("o"))), enabled: false };
    const style: Frame = {
      ...processed(control("style", layer("s"))),
      control: { ...defaultControl(), type: "style_transfer", model: "x" },
    };
    const adapter: Frame = processed(frame("ip", "ipAdapter", picture("i")));
    const outline = computeOutline([
      processed(frame("man", "initial", layer("m"))),
      off,
      style,
      adapter,
    ]);
    expect(outline.entries.map((e) => e.processor)).toEqual(["Canny", "Canny", null, null]);
  });

  it("gives every processed picture a map slot, and none without the processing facts", () => {
    const frames = [
      processed(frame("man", "initial", layer("m"))),
      processed(frame("pets", "reference", picture("dog"), picture("cat"))),
      frame("plain", "reference", picture("x")),
      processed(control("edges", layer("e"))),
    ];
    const outline = computeOutline(frames, { processing: processing() });
    expect(outline.sent.map((s) => s.map?.spec.kind ?? null)).toEqual([
      "composite",
      "file",
      "file",
      null,
    ]);
    expect(outline.controls[0].map?.spec.kind).toBe("composite");
    expect(outline.entries.map((e) => e.maps.length)).toEqual([1, 2, 0, 1]);
    // the frame's values over the server's defaults
    expect(outline.sent[0].map?.params).toEqual({ low_threshold: 50, high_threshold: 200 });
    expect(computeOutline(frames).sent.every((s) => s.map === null)).toBe(true);
    expect(computeOutline(frames).controls[0].map).toBeNull();
  });

  it("names the state of each map from the cache, the jobs and the failures", () => {
    const frames = [
      processed(frame("pets", "reference", picture("a"), picture("b"), picture("c"))),
    ];
    const keys = computeOutline(frames, { processing: processing() }).sent.map((s) => s.map?.key);
    const [a, b, c] = keys as string[];
    const outline = computeOutline(frames, {
      processing: processing({
        current: new Set([a]),
        lookedUp: new Set([a, b]),
        pending: new Map([[c, "processing"]]),
      }),
    });
    expect(outline.sent.map((s) => s.map?.state)).toEqual(["current", "needed", "processing"]);
    expect(statusWord(outline.entries[0])).toBe("1 of 3 processing");
    const failed = computeOutline(frames, {
      processing: processing({ lookedUp: new Set([a, b, c]), failed: new Map([[b, "no map"]]) }),
    });
    expect(failed.sent[1].map).toMatchObject({ state: "failed", reason: "no map" });
    expect(statusWord(failed.entries[0])).toBe("1 of 3 failed");
    expect(mapsWord(failed.entries[0].maps)).toBe("1 of 3 failed");
    const unknown = computeOutline(frames, { processing: processing() });
    expect(unknown.sent.map((s) => s.map?.state)).toEqual(["unknown", "unknown", "unknown"]);
    expect(statusWord(unknown.entries[0])).toBe("sent");
    const current = computeOutline(frames, {
      processing: processing({ current: new Set([a, b, c]), lookedUp: new Set([a, b, c]) }),
    });
    expect(statusWord(current.entries[0])).toBe("sent");
  });

  it("sizes a composite by how it travels", () => {
    const man = processed(frame("man", "initial", layer("m")));
    const env = processing({ target: { width: 2048, height: 1536 } });
    const alone = computeOutline([man], { processing: env }).sent[0].map?.spec;
    // a plain init goes out at frame size and the server resizes it
    expect(alone?.kind === "composite" && alone.out).toBeNull();
    // beside a control picture it is resized first
    const beside = computeOutline([man, processed(control("edges", layer("e")))], {
      processing: env,
    });
    const init = beside.sent[0].map?.spec;
    expect(init?.kind === "composite" && init.out).toEqual({ width: 2048, height: 1536 });
    const unit = beside.controls[0].map?.spec;
    expect(unit?.kind === "composite" && unit.out).toEqual({ width: 2048, height: 1536 });
    // in a set every member is resized first
    const set = computeOutline([man, frame("ref", "reference", picture("r"))], { processing: env });
    const member = set.sent[0].map?.spec;
    expect(member?.kind === "composite" && member.out).toEqual({ width: 2048, height: 1536 });
  });

  it("takes a linked Control frame's map from its source's composite", () => {
    const man = frame("man", "initial", layer("m"));
    const linked: Frame = { ...processed(control("edges")), link: { frameId: "man" } };
    const outline = computeOutline([man, linked], { processing: processing() });
    const spec = outline.controls[0].map?.spec;
    expect(spec?.kind === "composite" && spec.layers.map((l) => l.cid)).toEqual(["cid-m"]);
  });

  it("gives IP-Adapter and style transfer frames no map", () => {
    const style: Frame = {
      ...processed(control("style", layer("s"))),
      control: { ...defaultControl(), type: "style_transfer" },
    };
    const adapter: Frame = {
      ...processed(frame("faces", "ipAdapter", picture("f"))),
      ipAdapter: { ...defaultIpAdapter(), adapter: "Base SDXL" },
    };
    const outline = computeOutline([style, adapter], { processing: processing() });
    expect(outline.controls[0].map).toBeNull();
    expect(outline.entries.map((e) => e.maps.length)).toEqual([0, 0]);
  });

  it("blocks a cloud model until every map is current, with Process now as the fix", () => {
    const frames = [
      processed(frame("man", "initial", layer("m"))),
      processed(frame("pets", "reference", picture("dog"))),
    ];
    const keys = computeOutline(frames, { processing: processing() }).sent.map(
      (s) => s.map?.key ?? "",
    );
    const stale = computeOutline(frames, {
      processing: processing({ cloud: true, lookedUp: new Set(keys) }),
    });
    expect(stale.problems).toEqual([{ code: "cloudMaps", positions: [1, 2] }]);
    expect(fixLabel(stale.problems[0])).toBe("Process now");
    expect(problemText(stale.problems[0])).toBe(
      "This model runs elsewhere and cannot process pictures: Inputs 1-2 must be processed first.",
    );
    expect(statusWord(stale.entries[0])).toBe("blocked");
    const fine = computeOutline(frames, {
      processing: processing({ cloud: true, current: new Set(keys), lookedUp: new Set(keys) }),
    });
    expect(fine.problems).toEqual([]);
    // not yet looked up is not yet a problem
    const unknown = computeOutline(frames, { processing: processing({ cloud: true }) });
    expect(unknown.problems).toEqual([]);
    // a local model processes for itself
    const local = computeOutline(frames, { processing: processing({ lookedUp: new Set(keys) }) });
    expect(local.problems).toEqual([]);
  });

  it("leaves control frames out of the cloud rule, since a provider receives none", () => {
    const frames = [processed(control("edges", layer("e")))];
    const key = computeOutline(frames, { processing: processing() }).controls[0].map?.key ?? "";
    const outline = computeOutline(frames, {
      processing: processing({ cloud: true, lookedUp: new Set([key]) }),
    });
    expect(outline.controls[0].map?.state).toBe("needed");
    expect(outline.problems).toEqual([]);
  });

  it("says which number a Control frame would get if sent as an image", () => {
    const frames = [
      frame("man", "initial", layer("m")),
      frame("edges", "control", layer("e")),
      frame("ref", "reference", picture("r")),
    ];
    const address = sentAsImage(frames, "edges");
    expect(address && sendAsImageLabel(address)).toBe("Send as Image 2 instead");
    expect(sentAsImage(frames, "man")).toEqual({ kind: "image", n: 1 });
    expect(sentAsImage([frame("empty", "control")], "empty")).toBeNull();
  });
});
