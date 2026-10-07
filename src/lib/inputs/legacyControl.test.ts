import { describe, expect, it } from "vitest";
import {
  controlFingerprint,
  controlToFrames,
  readLegacyControl,
  type ControlImportContext,
  type LegacyBytes,
  type LegacyControlUnit,
  type RawControlUnit,
} from "./legacyControl";

const bytes = (width = 64, height = 64): LegacyBytes => ({ blob: new Blob(["x"]), width, height });

const raw = (patch: Partial<RawControlUnit> = {}): RawControlUnit => ({
  enabled: true,
  unitType: "controlnet",
  imageSource: "separate",
  processor: "Canny",
  model: "Xinsir",
  mode: "canny",
  strength: 0.8,
  start: 0,
  end: 0.9,
  image: "AAAA",
  processedImage: null,
  guess: true,
  factor: 1,
  attention: "Attention",
  fidelity: 0.5,
  queryWeight: 1,
  adainWeight: 1,
  adapter: "None",
  scale: 0.5,
  crop: false,
  images: [],
  masks: [],
  fitMode: "contain",
  freeTransform: null,
  processorParams: { low_threshold: 100 },
  ...patch,
});

const unit = (patch: Partial<LegacyControlUnit> = {}): LegacyControlUnit => ({
  ...raw(),
  image: bytes(),
  processedImage: null,
  images: [],
  masks: [],
  ...patch,
});

const placeholder = (): LegacyControlUnit =>
  unit({
    enabled: false,
    imageSource: "canvas",
    image: null,
    model: "None",
    processor: "None",
    guess: false,
    processorParams: {},
  });

const counter = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

const context: ControlImportContext = {
  size: { width: 1024, height: 512 },
  displayHeight: 512,
  initialFrameId: "init",
};

const convert = (units: LegacyControlUnit[], ctx = context) =>
  controlToFrames(units, ctx, counter("id"), counter("cid"));

describe("readLegacyControl", () => {
  it("reads the stored list loosely, filling missing fields with the store's defaults", () => {
    const units = readLegacyControl([
      { unitType: "ip", images: ["a", "b"], enabled: true },
      "junk",
      null,
    ]);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      unitType: "ip",
      images: ["a", "b"],
      enabled: true,
      imageSource: "canvas",
      model: "None",
      scale: 0.5,
      freeTransform: null,
      processorParams: {},
    });
    expect(readLegacyControl("not a list")).toEqual([]);
  });
});

describe("controlToFrames", () => {
  it("gives a unit its own picture, laid out by its fit mode, and its settings", () => {
    const { frames, notes } = convert([unit({ fitMode: "cover" })]);
    expect(notes).toEqual([]);
    expect(frames).toHaveLength(1);
    const [edges] = frames;
    expect(edges.role).toBe("control");
    expect(edges.fit).toBe("cover");
    expect(edges.enabled).toBe(true);
    expect(edges.pictures).toHaveLength(1);
    expect(edges.pictures[0].transform).toEqual({
      x: 0,
      y: -256,
      scaleX: 16,
      scaleY: 16,
      rotation: 0,
    });
    expect(edges.control).toMatchObject({
      type: "controlnet",
      model: "Xinsir",
      mode: "canny",
      strength: 0.8,
      end: 0.9,
      guess: true,
      process: "Canny",
      processParams: { low_threshold: 100 },
    });
    expect(edges.link).toBeNull();
    expect(edges.processed).toBeNull();
  });

  it("keeps a processed map with the frame", () => {
    const { frames } = convert([unit({ processedImage: bytes(1024, 512) })]);
    expect(frames[0].processed).toMatchObject({ width: 1024, height: 512 });
    expect(frames[0].processed?.blob).toBeInstanceOf(Blob);
  });

  it("turns a free transform from display units into frame pixels", () => {
    const free = { x: 10, y: 20, scaleX: 2, scaleY: 3, rotation: 15 };
    const same = convert([unit({ fitMode: "free", freeTransform: free })]);
    expect(same.frames[0].fit).toBeNull();
    expect(same.frames[0].pictures[0].transform).toEqual(free);
    const taller = convert([unit({ fitMode: "free", freeTransform: free })], {
      ...context,
      size: { width: 2048, height: 1024 },
    });
    expect(taller.frames[0].pictures[0].transform).toEqual({
      x: 20,
      y: 40,
      scaleX: 4,
      scaleY: 6,
      rotation: 15,
    });
    const centred = convert([unit({ fitMode: "free" })]);
    expect(centred.frames[0].pictures[0].transform?.scaleX).toBe(8);
  });

  it("links a unit that borrowed another unit's picture to that unit's frame", () => {
    const { frames, notes } = convert([unit(), unit({ imageSource: "unit:0", image: null })]);
    expect(notes).toEqual([]);
    expect(frames[1].link).toEqual({ frameId: frames[0].id });
    expect(frames[1].pictures).toEqual([]);
  });

  it("leaves a unit borrowing from a unit without a picture unlinked, and says so", () => {
    const { frames, notes } = convert([
      unit({ imageSource: "canvas", image: null, enabled: false }),
      unit({ imageSource: "unit:0", image: null }),
      unit({ imageSource: "unit:7", image: null }),
    ]);
    expect(frames.map((f) => f.link)).toEqual([{ frameId: "init" }, null, null]);
    expect(notes).toEqual([
      { kind: "controlUnlinked", position: 2 },
      { kind: "controlUnlinked", position: 3 },
    ]);
  });

  it("switches a unit on the canvas source off and links it to the Initial frame", () => {
    const { frames, notes } = convert([unit({ imageSource: "canvas", image: null })]);
    expect(frames[0]).toMatchObject({ enabled: false, link: { frameId: "init" } });
    expect(notes).toEqual([{ kind: "controlOff", position: 1, reason: "neverSent" }]);
    const quiet = convert([unit({ imageSource: "canvas", image: null, enabled: false })]);
    expect(quiet.notes).toEqual([]);
    const noInitial = convert([unit({ imageSource: "canvas", image: null })], {
      ...context,
      initialFrameId: null,
    });
    expect(noInitial.frames[0].link).toBeNull();
  });

  it("turns an IP-Adapter unit into an IP-Adapter frame with its pictures and masks", () => {
    const { frames } = convert([
      unit({
        unitType: "ip",
        adapter: "Base SDXL",
        scale: 0.7,
        crop: true,
        images: [bytes(), bytes(32, 32)],
        masks: [bytes()],
        image: null,
      }),
    ]);
    expect(frames[0].role).toBe("ipAdapter");
    expect(frames[0].pictures.map((p) => [p.width, p.transform])).toEqual([
      [64, null],
      [32, null],
    ]);
    expect(frames[0].ipAdapter).toMatchObject({ adapter: "Base SDXL", scale: 0.7, crop: true });
    expect(frames[0].ipAdapter.masks).toHaveLength(1);
  });

  it("drops the untouched placeholder unless something links to it", () => {
    expect(convert([placeholder()]).frames).toEqual([]);
    const kept = convert([placeholder(), unit({ imageSource: "unit:0", image: null })]);
    expect(kept.frames).toHaveLength(2);
    expect(kept.notes).toEqual([{ kind: "controlUnlinked", position: 2 }]);
  });

  it("retires a unit of a kind that no longer exists as ControlNet, switched off", () => {
    const { frames, notes } = convert([unit({ unitType: "asset" })]);
    expect(frames[0]).toMatchObject({ enabled: false, control: { type: "controlnet" } });
    expect(notes).toEqual([{ kind: "controlOff", position: 1, reason: "retiredType" }]);
  });
});

describe("controlFingerprint", () => {
  it("is the same for the same content and changes with it", () => {
    const a = controlFingerprint([raw(), raw({ unitType: "ip", images: ["aa"] })]);
    expect(a).toBe(controlFingerprint([raw(), raw({ unitType: "ip", images: ["aa"] })]));
    expect(controlFingerprint([raw({ image: "AAAAAAAA" })])).not.toBe(controlFingerprint([raw()]));
    expect(controlFingerprint([raw({ enabled: false })])).not.toBe(controlFingerprint([raw()]));
    expect(controlFingerprint([])).toBe(controlFingerprint("junk"));
  });
});
