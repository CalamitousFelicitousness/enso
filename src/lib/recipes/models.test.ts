import { describe, expect, it } from "vitest";
import {
  checkpointState,
  networkState,
  recipeStates,
  recordedModel,
  type LocalCheckpoint,
} from "./models";
import type { ModelId, NetworkId } from "./recipe";

const A = "a".repeat(64);
const B = "b".repeat(64);

const id = (over: Partial<ModelId> = {}): ModelId => ({
  title: "juggernaut [0123456789]",
  name: "juggernaut",
  path: "SDXL/juggernaut",
  sha256: A,
  shorthash: "0123456789",
  snapshot: null,
  class_name: null,
  type: "safetensors",
  ...over,
});

const local = (over: Partial<LocalCheckpoint> = {}): LocalCheckpoint => ({
  title: "juggernaut [0123456789]",
  model_name: "juggernaut",
  filename: "/models/SDXL/juggernaut.safetensors",
  hash: "0123456789",
  sha256: A,
  ...over,
});

const lora = (over: Partial<NetworkId> = {}): NetworkId => ({
  kind: "lora",
  name: "fur",
  sha256: A,
  short: null,
  ...over,
});

describe("checkpointState", () => {
  it("is installed by digest, short hash or snapshot", () => {
    expect(checkpointState(id(), [local({ hash: null })]).state).toBe("installed");
    expect(checkpointState(id({ sha256: null }), [local({ sha256: null })]).state).toBe(
      "installed",
    );
    const diffusers = id({ sha256: null, shorthash: null, snapshot: "abc123", type: "diffusers" });
    expect(checkpointState(diffusers, [local({ hash: null, sha256: "abc123" })]).state).toBe(
      "installed",
    );
  });

  it("tells another file of the same name from one not checked", () => {
    const other = local({ hash: "9999999999", sha256: B });
    expect(checkpointState(id(), [other])).toEqual({ state: "otherFile", match: other });
    expect(checkpointState(id(), [local({ hash: "9999999999", sha256: null })]).state).toBe(
      "unchecked",
    );
    expect(
      checkpointState(id({ sha256: null, shorthash: null }), [local({ hash: null })]).state,
    ).toBe("unchecked");
  });

  it("is missing with nothing of that name", () => {
    expect(checkpointState(id(), [local({ model_name: "other", hash: null, sha256: B })])).toEqual({
      state: "missing",
      match: null,
    });
  });

  it("counts a download this browser made for the digest before sdnext hashes it", () => {
    const fresh = local({
      hash: null,
      sha256: null,
      filename: "/models/SDXL/jugg_v11.safetensors",
    });
    const downloads = [{ sha256: A, filename: "jugg_v11.safetensors" }];
    expect(checkpointState(id(), [fresh], downloads).state).toBe("installed");
  });
});

describe("networkState", () => {
  it("compares a LoRA by its digest, never by sdnext's short hash", () => {
    expect(networkState(lora(), [{ name: "renamed", sha256: A }]).state).toBe("installed");
    expect(networkState(lora({ short: "abcd1234" }), [{ name: "fur", sha256: null }]).state).toBe(
      "unchecked",
    );
    expect(networkState(lora(), [{ name: "fur", sha256: B }]).state).toBe("otherFile");
    expect(networkState(lora(), [{ name: "other", sha256: B }]).state).toBe("missing");
  });
});

describe("recipeStates", () => {
  it("counts the LoRAs not found", () => {
    const states = recipeStates(
      { checkpoint: null, networks: [lora(), lora({ name: "gone", sha256: B })] },
      [],
      [{ name: "fur", sha256: A }],
    );
    expect(states).toMatchObject({ checkpoint: null, missingNetworks: 1 });
  });
});

describe("recordedModel", () => {
  it("reads the short hash sdnext puts in a title", () => {
    expect(recordedModel({ title: "SDXL/jugg [0123456789]", name: "jugg" })).toMatchObject({
      name: "jugg",
      shorthash: "0123456789",
      sha256: null,
    });
    expect(recordedModel({ title: "Qwen/Qwen-Image", name: "Qwen-Image" }).shorthash).toBeNull();
  });
});
