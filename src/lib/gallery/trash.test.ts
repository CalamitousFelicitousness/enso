import { describe, expect, it } from "vitest";
import type { CachedThumb, GalleryFile } from "@/api/types/gallery";
import type { ItemTrashedFileV2 } from "@/api/types/media";
import { filesRemovedByOthers, rekeyThumbs, sortTime, TRASH_FOLDER, trashFiles } from "./trash";

const item: ItemTrashedFileV2 = {
  id: "0123456789abcdef",
  name: "00044.png",
  folder: "/data/outputs/text",
  folder_label: "outputs/text/",
  path: "/data/enso/trash/0123456789abcdef/00044.png",
  kind: "image",
  size: 10,
  bytes: 20,
  mtime: 5,
  trashed_at: 1000,
  trashed_by: "alice",
  expires_at: 9000,
  output_ids: ["o1"],
  lost: false,
};

const thumb = (path: string): CachedThumb => ({
  path,
  folder: "/data/outputs/text",
  data: "data:x",
  width: 8,
  height: 8,
  size: 10,
  mtime: 5,
  exif: "",
});

describe("trashFiles", () => {
  it("lists a trashed file under the folder it came from", () => {
    const [file] = trashFiles([item]);
    expect(file).toEqual({
      folder: TRASH_FOLDER,
      relativePath: "outputs/text/00044.png",
      fullPath: item.path,
      id: "trash:0123456789abcdef",
      trash: {
        id: item.id,
        from: "outputs/text/",
        trashedAt: 1000,
        trashedBy: "alice",
        expiresAt: 9000,
        bytes: 20,
        lost: false,
      },
    });
  });
});

describe("sortTime", () => {
  it("sorts the trash by when files went there and a folder by mtime", () => {
    const [file] = trashFiles([item]);
    const plain: GalleryFile = {
      folder: file.folder,
      relativePath: file.relativePath,
      fullPath: file.fullPath,
      id: file.id,
    };
    expect(sortTime(file, thumb("x"))).toBe(1000);
    expect(sortTime(plain, thumb("x"))).toBe(5);
    expect(sortTime(plain, undefined)).toBe(0);
  });
});

describe("rekeyThumbs", () => {
  it("carries each found thumbnail to its new path and folder", () => {
    const found = new Map([["/data/outputs/text/a.png", thumb("/data/outputs/text/a.png")]]);
    const moved = rekeyThumbs(
      found,
      [
        { from: "/data/outputs/text/a.png", to: "/trash/1/a.png" },
        { from: "/data/outputs/text/b.png", to: "/trash/2/b.png" },
      ],
      () => TRASH_FOLDER,
    );
    expect(moved).toEqual([{ ...thumb("/trash/1/a.png"), folder: TRASH_FOLDER }]);
  });
});

describe("filesRemovedByOthers", () => {
  const by = (who: string | null) => ({
    ...trashFiles([item])[0],
    trash: { ...trashFiles([item])[0].trash!, trashedBy: who },
  });

  it("counts the files another user deleted, with the name when one did them all", () => {
    expect(filesRemovedByOthers([by("bob"), by("bob"), by("alice")], "alice")).toEqual({
      count: 2,
      name: "bob",
    });
    expect(filesRemovedByOthers([by("bob"), by("carol")], "alice")).toEqual({
      count: 2,
      name: null,
    });
  });

  it("counts nobody else for files with no user, or a folder's files", () => {
    expect(filesRemovedByOthers([by(null)], null)).toEqual({ count: 0, name: null });
    expect(filesRemovedByOthers([by(null)], "alice")).toEqual({ count: 0, name: null });
  });
});
