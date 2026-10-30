import { describe, expect, it } from "vitest";
import type { VideoCodec } from "@/api/types/video";
import { FALLBACK_CODECS, formatsFor, outputProblem, pickCodec } from "./codecs";

const qsv: VideoCodec = {
  name: "h264_qsv",
  title: "H.264 (Intel QuickSync)",
  description: "",
  ext: "mp4",
  allowed_exts: ["mp4", "mkv"],
  options: "global_quality=20:preset=medium",
  pix_fmt: null,
  hardware: null,
  available: false,
};
const codecs = [...FALLBACK_CODECS, qsv];

describe("codecs", () => {
  it("keeps a format the new codec writes and takes its options", () => {
    expect(pickCodec(FALLBACK_CODECS[1], "mkv")).toEqual({
      format: "mkv",
      codecOptions: "crf=22,preset=medium",
    });
  });

  it("switches to the codec's own container when it cannot write the current one", () => {
    expect(pickCodec(FALLBACK_CODECS[2], "mp4").format).toBe("webm");
  });

  it("says a stale gif fails", () => {
    expect(outputProblem(codecs, "libx264", "gif")).toBe(
      "H.264 / AVC cannot be saved as gif, so the job will fail. It saves as mp4, mkv, mov or ts.",
    );
    expect(outputProblem(codecs, "libx264", "mp4")).toBeNull();
  });

  it("says an unavailable codec fails", () => {
    expect(outputProblem(codecs, "h264_qsv", "mp4")).toBe(
      "H.264 (Intel QuickSync) is not available on this server, so the job will fail.",
    );
  });

  it("offers every listed container for a codec outside the table", () => {
    expect(formatsFor(codecs, "libaom-av1")).toEqual(["mp4", "mkv", "mov", "ts", "webm", "avi"]);
    expect(outputProblem(codecs, "libaom-av1", "mp4")).toBeNull();
  });
});
