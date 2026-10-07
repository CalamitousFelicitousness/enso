import { describe, expect, it } from "vitest";
import { frame, layer } from "./frames.fixture";
import {
  acceptOffer,
  applyImports,
  declineOffer,
  EMPTY_WORKING,
  planImports,
  type LegacySource,
} from "./imports";
import { legacyFingerprint, legacyToFrames } from "./legacy";
import { CANVAS_V3_RECORD, canvasV4Record } from "./legacyRecords.fixture";
import { newFrame } from "./reducers";
import type { WorkingDocument } from "./stored";

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const legacyLayer = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  type: "image",
  name: `${id}.png`,
  file: new File([id], `${id}.png`),
  naturalWidth: 64,
  naturalHeight: 64,
  ...patch,
});

const legacyState = (frameId: string, ...layers: unknown[]) => ({
  inputFrames: [{ id: frameId, mode: "initial", layers }],
  activeInputFrameId: frameId,
  sizeSource: { frameId, refId: null },
});

const converted = (state: unknown) => legacyToFrames(state, counter("cid"));
const v4 = (fingerprint: string | null): LegacySource => ({ id: "canvas-v4", fingerprint });
const v3 = (fingerprint: string | null): LegacySource => ({ id: "canvas-v3", fingerprint });
const ids = (doc: WorkingDocument) => doc.frames.map((f) => f.id);
const NOTHING = { load: null, seen: [], offers: [] };

describe("planImports", () => {
  it("on first contact loads the newest record and marks older ones seen", () => {
    expect(planImports({}, [v4("a1"), v3(null)])).toEqual({ ...NOTHING, load: v4("a1") });
    expect(planImports({}, [v4("a1"), v3("b1")])).toEqual({
      load: v4("a1"),
      seen: [v3("b1")],
      offers: [],
    });
    expect(planImports({}, [v4(null), v3("b1")])).toEqual({ ...NOTHING, load: v3("b1") });
  });

  it("leaves records alone once they carry their marks", () => {
    const imports = { "canvas-v4": "a1", "canvas-v3": "b1" };
    expect(planImports(imports, [v4("a1"), v3("b1")])).toEqual(NOTHING);
  });

  it("offers the newest format when its record changed after the import", () => {
    expect(planImports({ "canvas-v4": "a1" }, [v4("a2"), v3(null)])).toEqual({
      ...NOTHING,
      offers: [v4("a2")],
    });
  });

  it("marks a newer record that holds what was imported from the older format", () => {
    // an older build upgraded the version 3 record in place, ids and all
    expect(planImports({ "canvas-v3": "same" }, [v4("same"), v3("same")])).toEqual({
      ...NOTHING,
      seen: [v4("same")],
    });
  });

  it("offers a newer record that appears with other content", () => {
    expect(planImports({ "canvas-v3": "b1" }, [v4("a1"), v3("b1")])).toEqual({
      ...NOTHING,
      offers: [v4("a1")],
    });
  });

  it("does not watch older formats once the content is known", () => {
    const imports = { "canvas-v4": "a1", "canvas-v3": "b1" };
    expect(planImports(imports, [v4("a1"), v3("b2")])).toEqual(NOTHING);
    expect(planImports({ "canvas-v3": "b1" }, [v4(null), v3("b2")])).toEqual(NOTHING);
  });

  it("finds nothing to do without records", () => {
    expect(planImports({}, [v4(null), v3(null)])).toEqual(NOTHING);
  });
});

describe("applyImports", () => {
  it("fills an empty document and adopts the import's selection", () => {
    const plan = planImports({}, [v4("a1"), v3("b1")]);
    const state = legacyState("f", legacyLayer("a"));
    const { doc, notes } = applyImports(EMPTY_WORKING, plan, converted(state), counter("id"));
    expect(ids(doc)).toEqual(["f"]);
    expect(doc.selectedFrameId).toBe("f");
    expect(doc.sizeSource).toEqual({ frameId: "f", pictureId: null });
    expect(doc.imports).toEqual({ "canvas-v4": "a1", "canvas-v3": "b1" });
    expect(notes).toEqual([]);
    // and the plan for the next page load is empty
    expect(planImports(doc.imports, [v4("a1"), v3("b1")])).toEqual(NOTHING);
  });

  it("replaces a document that holds only empty frames", () => {
    const seed: WorkingDocument = {
      ...EMPTY_WORKING,
      frames: [newFrame("seed", "initial")],
      selectedFrameId: "seed",
    };
    const state = legacyState("f", legacyLayer("a"));
    const { doc } = applyImports(
      seed,
      planImports({}, [v4("a1")]),
      converted(state),
      counter("id"),
    );
    expect(ids(doc)).toEqual(["f"]);
    expect(doc.selectedFrameId).toBe("f");
  });

  it("appends to a document that holds pictures, keeping its selection", () => {
    const own: WorkingDocument = {
      ...EMPTY_WORKING,
      frames: [frame("mine", "initial", layer("m"))],
      selectedFrameId: "mine",
    };
    const state = legacyState("f", legacyLayer("a", { file: null }));
    const out = applyImports(own, planImports({}, [v4("a1")]), converted(state), counter("id"));
    expect(ids(out.doc)).toEqual(["mine", "f"]);
    expect(out.doc.selectedFrameId).toBe("mine");
    // notes point at the frame's place in the whole list
    expect(out.notes).toEqual([{ kind: "unreadablePicture", position: 2, name: "a.png" }]);
  });

  it("never repeats an id the document already uses", () => {
    const own: WorkingDocument = {
      ...EMPTY_WORKING,
      frames: [frame("f", "initial", layer("a"))],
    };
    const state = legacyState("f", legacyLayer("a"));
    const { doc } = applyImports(own, planImports({}, [v4("a1")]), converted(state), counter("id"));
    expect(ids(doc)).toEqual(["f", "id-1"]);
    expect(doc.frames[1].pictures.map((p) => p.id)).toEqual(["id-2"]);
  });

  it("marks nothing when the record to load could not be read", () => {
    const plan = planImports({}, [v4("a1"), v3("b1")]);
    const { doc } = applyImports(EMPTY_WORKING, plan, null, counter("id"));
    expect(doc).toBe(EMPTY_WORKING);
  });

  it("marks a record that converts to nothing, so it is not read again", () => {
    const { doc } = applyImports(
      EMPTY_WORKING,
      planImports({}, [v4("a1")]),
      converted(null),
      () => "x",
    );
    expect(doc.frames).toEqual([]);
    expect(doc.imports).toEqual({ "canvas-v4": "a1" });
  });

  it("returns the same document for a plan that changes nothing", () => {
    const doc = { ...EMPTY_WORKING, imports: { "canvas-v4": "a1" } };
    const offer = planImports(doc.imports, [v4("a2")]);
    expect(applyImports(doc, offer, null, () => "x").doc).toBe(doc);
    expect(applyImports(doc, planImports(doc.imports, [v4("a1")]), null, () => "x").doc).toBe(doc);
  });
});

describe("offers", () => {
  const first = legacyState("f", legacyLayer("a"));
  const imported = applyImports(
    EMPTY_WORKING,
    planImports({}, [v4("a1")]),
    converted(first),
    counter("id"),
  ).doc;
  const changed = legacyState("f", legacyLayer("a"), legacyLayer("b"));
  const [offer] = planImports(imported.imports, [v4("a2")]).offers;

  it("adds an accepted record under new ids and stops offering it", () => {
    const { doc } = acceptOffer(imported, offer, converted(changed), counter("id"));
    expect(ids(doc)).toEqual(["f", "id-1"]);
    expect(doc.frames[1].pictures.map((p) => p.id)).toEqual(["id-2", "id-3"]);
    expect(doc.selectedFrameId).toBe("f");
    expect(planImports(doc.imports, [v4("a2")]).offers).toEqual([]);
  });

  it("stops offering a declined record until it changes again", () => {
    const doc = declineOffer(imported, offer);
    expect(ids(doc)).toEqual(["f"]);
    expect(planImports(doc.imports, [v4("a2")]).offers).toEqual([]);
    expect(planImports(doc.imports, [v4("a3")]).offers).toEqual([v4("a3")]);
  });
});

describe("a rollback that upgrades the version 3 record", () => {
  it("does not import the same canvas a second time", () => {
    // first run on a profile that only has the version 3 record
    const v3State = (JSON.parse(CANVAS_V3_RECORD) as { state: unknown }).state;
    const v3Mark = legacyFingerprint(v3State);
    const first = applyImports(
      EMPTY_WORKING,
      planImports({}, [v4(null), v3(v3Mark)]),
      converted(v3State),
      counter("id"),
    ).doc;
    expect(first.frames).toHaveLength(1);
    // the older build then writes the version 4 record from it, keeping every id
    const upgraded = {
      inputFrames: [
        {
          id: first.frames[0].id,
          mode: "reference",
          layers: [
            { id: "orphan-layer-test", type: "image", file: new File(["x"], "leftover.png") },
          ],
          references: [],
          maskLines: [],
        },
      ],
    };
    const plan = planImports(first.imports, [v4(legacyFingerprint(upgraded)), v3(v3Mark)]);
    expect(plan).toEqual({ ...NOTHING, seen: [v4(v3Mark)] });
    const again = applyImports(first, plan, null, counter("id")).doc;
    expect(again.frames).toBe(first.frames);
  });

  it("gives the two dumped records of one profile different fingerprints", () => {
    // they hold different frames' content, so the newer one would be offered
    const v3State = (JSON.parse(CANVAS_V3_RECORD) as { state: unknown }).state;
    expect(legacyFingerprint(canvasV4Record().state)).not.toBe(legacyFingerprint(v3State));
  });
});

describe("imports that keep the document's frames", () => {
  it("join an empty document's frames instead of standing in for them", () => {
    const seed = newFrame("seed", "initial");
    const own: WorkingDocument = { ...EMPTY_WORKING, frames: [seed], selectedFrameId: "seed" };
    const loaded = converted(legacyState("f1", legacyLayer("l1")));
    const plan = planImports({}, [v4("a1")]);
    const kept = applyImports(own, plan, loaded, counter("id"), true).doc;
    expect(ids(kept)).toEqual(["seed", "f1"]);
    expect(kept.selectedFrameId).toBe("seed");
    const replaced = applyImports(own, plan, loaded, counter("id")).doc;
    expect(ids(replaced)).toEqual(["f1"]);
  });
});
