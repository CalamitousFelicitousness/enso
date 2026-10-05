import { describe, expect, it } from "vitest";
import { frame, layer, picture } from "./frames.fixture";
import {
  computeOutline,
  controlUnitPosition,
  firstComposite,
  loneReference,
  outlineEntry,
  resolveSizeSource,
  sizeSourcePick,
  type Outline,
  type SizeSourcePick,
} from "./outline";
import { addressLabel, sentLabel, unreadableText } from "./text";
import type { Frame } from "./types";

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

  it("places control units after the frames", () => {
    expect(controlUnitPosition(3, 0)).toBe(4);
    expect(controlUnitPosition(3, 2)).toBe(6);
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
      "A stored picture in Input 1, Input 2 could not be read. Replace or remove it.",
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

  it("falls back to the first picture once the pick is gone", () => {
    expect(sized([man, refs], { frameId: "refs", pictureId: "gone" })).toBe("1:1336x744");
    expect(sized([refs], { frameId: "man", pictureId: null })).toBe("1:1024x1536");
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
