import { describe, expect, it } from "vitest";
import {
  aboutSize,
  ageText,
  batchText,
  fetchingText,
  keptOutText,
  submitFailureText,
  uploadFailureText,
  uploadingText,
} from "./text";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MB = 1024 * 1024;

describe("ageText", () => {
  it("dates a row in one style for every list", () => {
    expect(ageText(30_000)).toBe("just now");
    expect(ageText(5 * MINUTE)).toBe("5 min ago");
    expect(ageText(3 * HOUR + 59 * MINUTE)).toBe("3 h ago");
    expect(ageText(DAY)).toBe("1 day ago");
    expect(ageText(9 * DAY)).toBe("9 days ago");
  });
});

describe("aboutSize", () => {
  it("rounds to what people read", () => {
    expect(aboutSize(10)).toBe("about 1 KB");
    expect(aboutSize(85 * MB)).toBe("about 85 MB");
    expect(aboutSize(1.2 * 1024 * MB)).toBe("about 1.2 GB");
  });
});

describe("uploadFailureText", () => {
  it("words each reason an upload did not land", () => {
    expect(
      uploadFailureText({ kind: "space", room: 1.2 * 1024 * MB, needed: 2.3 * 1024 * MB }),
    ).toBe("Not enough space on the server: this needs about 2.3 GB and it can take about 1.2 GB");
    expect(uploadFailureText({ kind: "full" })).toBe("The server's disk is full");
    expect(uploadFailureText({ kind: "stalled" })).toBe(
      "The upload stalled; check the connection and try again",
    );
    expect(uploadFailureText({ kind: "network" })).toBe("The server could not be reached");
    expect(uploadFailureText({ kind: "busy" })).toBe("The server is busy; try again in a minute");
    expect(uploadFailureText({ kind: "unreadable", name: "cat.png" })).toBe(
      "cat.png can no longer be read; add it again",
    );
    expect(
      uploadFailureText({ kind: "storeOff", message: "Media store off: /x is not writable" }),
    ).toBe("Media store off: /x is not writable");
  });
});

describe("the words of a submit", () => {
  it("say how far an upload has got", () => {
    expect(uploadingText(28)).toBe("Uploading 28%");
    expect(batchText(2, 3, 120 * MB, 480 * MB)).toBe(
      "Uploading 2 of 3 files, about 120 MB of 480 MB",
    );
    expect(batchText(0, 1, 0, 0)).toBe("Uploading 0 of 1 file");
    expect(fetchingText(1, 4, 120 * MB)).toBe("Fetching 1 of 4 pictures, about 120 MB");
    expect(fetchingText(0, 1, 0)).toBe("Fetching 0 of 1 picture");
  });

  it("say what was not kept with a job, and why a job was not sent", () => {
    expect(keptOutText(1, 1200 * MB)).toBe(
      "1 picture was not kept with the job: the server can take about 1.2 GB more",
    );
    expect(keptOutText(3, 5 * MB)).toBe(
      "3 pictures were not kept with the job: the server can take about 5 MB more",
    );
    expect(submitFailureText({ kind: "stillMissing", names: ["cat.png", "a", "b"] })).toBe(
      "The server does not hold cat.png and 2 more after a second try",
    );
    expect(submitFailureText({ kind: "stillMissing", names: [] })).toBe(
      "The server does not hold a picture after a second try",
    );
    expect(submitFailureText({ kind: "removed" })).toBe(
      "This job was queued before and has since been removed",
    );
    expect(submitFailureText({ kind: "tooLarge" })).toContain("too large");
  });
});
