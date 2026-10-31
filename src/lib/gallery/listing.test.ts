import { describe, expect, it } from "vitest";
import type { CachedThumb, GalleryFile } from "@/api/types/gallery";
import { carriedThumbs, changedFiles, parseFileEntry, thumbFits } from "./listing";

const listed = (name: string, mtime: number | null, size: number | null): GalleryFile => ({
  folder: "/out",
  relativePath: name,
  fullPath: `/out/${name}`,
  id: `/out##F##${name}`,
  mtime,
  size,
});

const thumb = (mtime: number, size: number): CachedThumb => ({
  path: "/out/a.png",
  folder: "/out",
  data: "data:x",
  width: 8,
  height: 8,
  size,
  mtime,
  exif: "",
});

describe("parseFileEntry", () => {
  it("reads the folder, the path under it and the stamp, and names the path by the id", () => {
    expect(parseFileEntry("/data/out##F##text/a%20b.png##T##1760000000123.7")).toEqual({
      folder: "/data/out",
      relativePath: "text/a b.png",
      fullPath: "/data/out/text/a b.png",
      id: "/data/out##F##text/a%20b.png",
      mtime: 1760000000123,
      size: 7,
    });
  });

  it("keeps a Windows drive's colon", () => {
    const file = parseFileEntry("C:/out##F##a.png##T##5.1");
    expect(file.fullPath).toBe("C:/out/a.png");
    expect(parseFileEntry("C%3A/out##F##a.png##T##5.1").fullPath).toBe("C:/out/a.png");
  });

  it("decodes separators inside a name", () => {
    const file = parseFileEntry("/out##F##a%23%23T%23%231.2.png##T##5.1");
    expect(file.relativePath).toBe("a##T##1.2.png");
    expect([file.mtime, file.size]).toEqual([5, 1]);
  });

  it("leaves the stamp null when the server sends none or a malformed one", () => {
    expect(parseFileEntry("/out##F##a.png")).toMatchObject({
      id: "/out##F##a.png",
      mtime: null,
      size: null,
    });
    expect(parseFileEntry("/out##F##a.png##T##soon")).toMatchObject({ mtime: null, size: null });
  });
});

describe("thumbFits", () => {
  it("takes a thumbnail of the listed file only", () => {
    expect(thumbFits(listed("a.png", 5, 10), thumb(5, 10))).toBe(true);
    expect(thumbFits(listed("a.png", 6, 10), thumb(5, 10))).toBe(false);
    expect(thumbFits(listed("a.png", 5, 11), thumb(5, 10))).toBe(false);
    expect(thumbFits(listed("a.png", null, null), thumb(5, 10))).toBe(false);
  });
});

describe("changedFiles", () => {
  it("brings files new to the list and files written again at their path", () => {
    const before = [listed("a.png", 5, 10), listed("b.png", 5, 10)];
    const after = [listed("a.png", 5, 10), listed("b.png", 9, 12), listed("c.png", 5, 10)];
    expect(changedFiles(before, after).map((f) => f.relativePath)).toEqual(["b.png", "c.png"]);
  });
});

describe("carriedThumbs", () => {
  it("drops the thumbnail of a file written again and of a file gone", () => {
    const before = [listed("a.png", 5, 10), listed("b.png", 5, 10), listed("c.png", 5, 10)];
    const after = [listed("a.png", 5, 10), listed("b.png", 9, 12)];
    const thumbs = new Map(before.map((f) => [f.id, thumb(5, 10)]));
    expect([...carriedThumbs(before, after, thumbs).keys()]).toEqual([after[0].id]);
  });

  it("keeps a thumbnail drawn from the file as it is now listed", () => {
    const before = [listed("a.png", 5, 10)];
    const after = [listed("a.png", 9, 12)];
    const thumbs = new Map([[after[0].id, thumb(9, 12)]]);
    expect(carriedThumbs(before, after, thumbs).has(after[0].id)).toBe(true);
  });

  it("keeps an unchanged file's thumbnail even when it does not match, as a lost file's placeholder", () => {
    const files = [listed("a.png", 5, 10)];
    const thumbs = new Map([[files[0].id, thumb(0, 0)]]);
    expect(carriedThumbs(files, files, thumbs).has(files[0].id)).toBe(true);
  });

  it("takes a thumbnail of a file not listed before only when it fits", () => {
    const after = [listed("a.png", 5, 10), listed("b.png", 5, 10)];
    const thumbs = new Map([
      [after[0].id, thumb(5, 10)],
      [after[1].id, thumb(4, 10)],
    ]);
    expect([...carriedThumbs([], after, thumbs).keys()]).toEqual([after[0].id]);
  });
});
