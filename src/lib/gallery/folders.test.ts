import { describe, expect, it } from "vitest";
import { folderLabel } from "./folders";
import { TRASH_FOLDER } from "./trash";

const folders = [
  { path: "/home/u/database/", label: "database" },
  { path: "/home/u/database/outputs/text", label: "outputs/text" },
  { path: "models/Reference", label: "Reference" },
];

describe("folderLabel", () => {
  it("names a listed folder by its label", () => {
    expect(folderLabel("/home/u/database/outputs/text", folders)).toBe("outputs/text");
    expect(folderLabel("/home/u/database", folders)).toBe("database");
  });

  it("names a folder under a listed one by the nearest label and the rest", () => {
    expect(folderLabel("/home/u/database/outputs/text/Qwen", folders)).toBe("outputs/text/Qwen");
    expect(folderLabel("/home/u/database/models/VAE/", folders)).toBe("database/models/VAE");
    expect(folderLabel("models/Reference/faces", folders)).toBe("Reference/faces");
  });

  it("does not take a folder whose name only starts the same", () => {
    expect(folderLabel("/home/u/database/outputs/textures", folders)).toBe(
      "database/outputs/textures",
    );
  });

  it("names the Trash folder and keeps the last two parts of an unlisted path", () => {
    expect(folderLabel(TRASH_FOLDER, folders)).toBe("Trash");
    expect(folderLabel("/srv/other/place", folders)).toBe("other/place");
  });
});
