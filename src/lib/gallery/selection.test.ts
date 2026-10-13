import { describe, expect, it } from "vitest";
import type { GalleryFile } from "@/api/types/gallery";
import { galleryTargets, pruneSelection, relocate, shownSelection } from "./selection";

const file = (name: string): GalleryFile => ({
  folder: "/out",
  relativePath: name,
  fullPath: `/out/${name}`,
  id: `/out##F##${name}`,
});
const [a, b, c] = [file("a.png"), file("b.png"), file("c.png")];

describe("galleryTargets", () => {
  const base = {
    selectedIds: new Set<string>(),
    sortedFiles: [a, b, c],
    focusedId: null,
    selectedFile: null,
  };

  it("takes the selection as the grid shows it", () => {
    const targets = galleryTargets({
      ...base,
      sortedFiles: [a, c],
      selectedIds: new Set([a.id, b.id, c.id]),
    });
    expect(targets).toEqual([a, c]);
  });

  it("takes the focused card when nothing is selected, before the clicked file", () => {
    expect(galleryTargets({ ...base, focusedId: b.id, selectedFile: a })).toEqual([b]);
  });

  it("takes the single-clicked file while the grid shows it", () => {
    expect(galleryTargets({ ...base, selectedFile: a })).toEqual([a]);
    expect(galleryTargets({ ...base, sortedFiles: [b, c], selectedFile: a })).toEqual([]);
  });

  it("takes nothing when nothing is chosen", () => {
    expect(galleryTargets(base)).toEqual([]);
  });
});

describe("shownSelection", () => {
  it("counts the selected files a search hides", () => {
    expect(shownSelection(new Set([a.id, b.id, c.id]), [a])).toEqual({ shown: [a], hidden: 2 });
  });
});

describe("pruneSelection", () => {
  it("drops the files that left the folder and says the clicked one left", () => {
    const kept = pruneSelection(
      { selectedIds: new Set([a.id, b.id]), selectedFile: b },
      [a, b, c],
      [a, c],
    );
    expect([...kept.selectedIds]).toEqual([a.id]);
    expect(kept.selectedFile).toBeNull();
    expect(kept.left).toBe(true);
  });

  it("follows a file whose id changed, by its path", () => {
    const moved = { ...b, id: "/out##F##other-id" };
    const kept = pruneSelection(
      { selectedIds: new Set([b.id]), selectedFile: b },
      [a, b],
      [a, moved],
    );
    expect([...kept.selectedIds]).toEqual([moved.id]);
    expect(kept.selectedFile).toBe(moved);
    expect(kept.left).toBe(false);
  });

  it("says nothing left when nothing was clicked", () => {
    expect(pruneSelection({ selectedIds: new Set(), selectedFile: null }, [a], []).left).toBe(
      false,
    );
  });
});

describe("relocate", () => {
  it("finds the lightbox's file in the new order", () => {
    expect(relocate(0, [a, b, c], [c, b, a])).toBe(2);
  });

  it("follows a file whose id changed, by its path", () => {
    expect(relocate(1, [a, b], [{ ...b, id: "/out##F##other-id" }, a])).toBe(0);
  });

  it("answers null when the file left", () => {
    expect(relocate(1, [a, b, c], [a, c])).toBeNull();
    expect(relocate(5, [a], [a])).toBeNull();
  });
});
