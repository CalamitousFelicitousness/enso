import { useMemo } from "react";
import type { ExtraNetworkV2 } from "@/api/types/models";
import type { TypeFilter, SortMode, SidebarGroup, NetworkItem, FolderNode } from "./types";
import { TAG_CATEGORIES, EXCLUDED_VERSIONS } from "./constants";
import { isExtraNetwork, isReferenceName, itemHasTag, itemPath } from "./utils";

/** Build a nested folder tree from a set of folder paths. */
function buildFolderTree(
  paths: Iterable<string>,
  counts?: Map<string, number>,
): FolderNode[] {
  const root: FolderNode[] = [];
  const nodeMap = new Map<string, FolderNode>();
  const sorted = Array.from(paths).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  for (const p of sorted) {
    const segments = p.split("/");
    let parent: FolderNode[] = root;
    let current = "";
    for (const seg of segments) {
      current = current ? `${current}/${seg}` : seg;
      let node = nodeMap.get(current);
      if (!node) {
        node = { name: seg, path: current, children: [], count: counts?.get(current) ?? 0 };
        nodeMap.set(current, node);
        parent.push(node);
      }
      parent = node.children;
    }
  }
  return root;
}

/** Collect all folder paths (including intermediate) from item paths, with item counts per folder. */
function collectFolderPaths(
  items: NetworkItem[],
  stripPrefix?: string,
): { dirs: Set<string>; folderCounts: Map<string, number> } {
  const dirs = new Set<string>();
  const folderCounts = new Map<string, number>();
  for (const item of items) {
    let name = itemPath(item);
    if (stripPrefix && name.startsWith(stripPrefix)) name = name.substring(stripPrefix.length);
    const lastSlash = name.lastIndexOf("/");
    if (lastSlash <= 0) continue;
    const folder = name.substring(0, lastSlash);
    const segments = folder.split("/");
    let path = "";
    for (const seg of segments) {
      path = path ? `${path}/${seg}` : seg;
      dirs.add(path);
      folderCounts.set(path, (folderCounts.get(path) ?? 0) + 1);
    }
  }
  return { dirs, folderCounts };
}

export function useNetworkFiltering(
  filtered: NetworkItem[],
  filter: TypeFilter,
  selectedSubfolder: string,
  sortMode: SortMode,
) {
  const versionSet = useMemo(() => {
    const versions = new Set<string>();
    for (const item of filtered) {
      if (
        isExtraNetwork(item) &&
        item.version &&
        !EXCLUDED_VERSIONS.has(item.version.toLowerCase())
      ) {
        versions.add(item.version);
      }
    }
    return versions;
  }, [filtered]);

  const sidebarGroups = useMemo((): SidebarGroup[] => {
    const sortedVersions = Array.from(versionSet).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );

    if (filter === "Model") {
      let hasLocal = false;
      let hasDiffusers = false;
      let hasReference = false;
      const tagHits = new Map<string, boolean>();
      for (const cat of TAG_CATEGORIES) tagHits.set(cat.toLowerCase(), false);
      const localItems: NetworkItem[] = [];

      for (const item of filtered) {
        if (!isExtraNetwork(item)) continue;
        const isRef = isReferenceName(item.name);
        const isDiff = item.name.startsWith("Diffusers/");
        if (!isRef && !isDiff) {
          hasLocal = true;
          localItems.push(item);
        }
        if (isDiff) hasDiffusers = true;
        if (isRef && item.tags.length === 0) hasReference = true;
        for (const cat of TAG_CATEGORIES) {
          if (itemHasTag(item, cat.toLowerCase()))
            tagHits.set(cat.toLowerCase(), true);
        }
      }

      const categories: string[] = [];
      if (hasLocal) categories.push("Local");
      if (hasDiffusers) categories.push("Diffusers");
      if (hasReference) categories.push("Reference");
      for (const cat of TAG_CATEGORIES) {
        if (tagHits.get(cat.toLowerCase())) categories.push(cat);
      }

      const groups: SidebarGroup[] = [{ items: ["All", ...categories] }];
      if (sortedVersions.length > 0)
        groups.push({ header: "Class", items: sortedVersions });
      return groups;
    }

    if (filter === "Style") {
      const categories: string[] = [];
      for (const item of filtered) {
        if (isReferenceName(item.name)) {
          if (!categories.includes("Reference")) categories.push("Reference");
        } else {
          if (!categories.includes("Local")) categories.unshift("Local");
        }
      }
      return [{ items: ["All", ...categories] }];
    }

    // LoRA, Wildcards, Embedding, VAE
    const groups: SidebarGroup[] = [{ items: ["All"] }];
    if (sortedVersions.length > 0)
      groups.push({ header: "Class", items: sortedVersions });
    return groups;
  }, [filtered, filter, versionSet]);

  const displayItems = useMemo(() => {
    let items: NetworkItem[];

    if (selectedSubfolder.startsWith("folder:")) {
      const prefix = selectedSubfolder.slice(7) + "/";
      const altPrefix = "models/" + prefix;
      items = filtered.filter((item) => {
        const p = itemPath(item);
        return p.startsWith(prefix) || p.startsWith(altPrefix);
      });
    } else if (selectedSubfolder === "All") {
      items = filtered;
    } else if (filter === "Model") {
      if (selectedSubfolder === "Local") {
        items = filtered.filter(
          (item) =>
            isExtraNetwork(item) &&
            !isReferenceName(item.name) &&
            !item.name.startsWith("Diffusers/"),
        );
      } else if (selectedSubfolder === "Diffusers") {
        items = filtered.filter(
          (item) => isExtraNetwork(item) && item.name.startsWith("Diffusers/"),
        );
      } else if (selectedSubfolder === "Reference") {
        items = filtered.filter(
          (item) =>
            isExtraNetwork(item) &&
            isReferenceName(item.name) &&
            item.tags.length === 0,
        );
      } else {
        const tagCat = TAG_CATEGORIES.find((c) => c === selectedSubfolder);
        if (tagCat) {
          items = filtered.filter(
            (item) =>
              isExtraNetwork(item) && itemHasTag(item, tagCat.toLowerCase()),
          );
        } else if (versionSet.has(selectedSubfolder)) {
          items = filtered.filter(
            (item) =>
              isExtraNetwork(item) && item.version === selectedSubfolder,
          );
        } else {
          const prefix = selectedSubfolder + "/";
          const altPrefix = "models/" + prefix;
          items = filtered.filter((item) => {
            const p = itemPath(item);
            return p.startsWith(prefix) || p.startsWith(altPrefix);
          });
        }
      }
    } else if (filter === "Style") {
      if (selectedSubfolder === "Local")
        items = filtered.filter((item) => !isReferenceName(item.name));
      else if (selectedSubfolder === "Reference")
        items = filtered.filter((item) => isReferenceName(item.name));
      else items = filtered;
    } else if (versionSet.has(selectedSubfolder)) {
      items = filtered.filter(
        (item) => isExtraNetwork(item) && item.version === selectedSubfolder,
      );
    } else {
      const prefix = selectedSubfolder + "/";
      items = filtered.filter((item) => itemPath(item).startsWith(prefix));
    }

    // Client-side sort
    if (sortMode === "name") {
      return [...items].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    }
    if (sortMode === "base-model") {
      return [...items].sort((a, b) => {
        const va = isExtraNetwork(a) ? (a as ExtraNetworkV2).version ?? "" : "";
        const vb = isExtraNetwork(b) ? (b as ExtraNetworkV2).version ?? "" : "";
        return (
          va.localeCompare(vb, undefined, { sensitivity: "base" }) ||
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        );
      });
    }
    // "recent" - newest first by mtime, then name as tiebreaker. ISO 8601 is
    // lexicographically sortable; null mtime sorts to the end.
    return [...items].sort((a, b) => {
      const ma = a.mtime ?? "";
      const mb = b.mtime ?? "";
      return (
        mb.localeCompare(ma, undefined, { sensitivity: "base" }) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
    });
  }, [filtered, selectedSubfolder, filter, versionSet, sortMode]);

  const { folderTree, classFolders } = useMemo(() => {
    if (filter === "Style") return { folderTree: [] as FolderNode[], classFolders: new Map<string, FolderNode[]>() };
    const stripPrefix = filter === "Model" ? "models/" : undefined;
    const relevantItems = filter === "Model"
      ? filtered.filter((item) => isExtraNetwork(item) && !isReferenceName(item.name) && !item.name.startsWith("Diffusers/"))
      : filtered;
    const { dirs, folderCounts } = collectFolderPaths(relevantItems, stripPrefix);
    const tree = buildFolderTree(dirs, folderCounts);

    // Split: top-level folders matching a class name go into classFolders, rest stay in folderTree
    const cf = new Map<string, FolderNode[]>();
    const remaining: FolderNode[] = [];
    const versionLower = new Map<string, string>();
    for (const v of versionSet) versionLower.set(v.toLowerCase(), v);
    for (const node of tree) {
      const match = versionLower.get(node.name.toLowerCase());
      if (match && node.children.length > 0) {
        cf.set(match, node.children);
      } else if (match) {
        // Folder matches class but has no subfolders - no tree needed
      } else {
        remaining.push(node);
      }
    }
    return { folderTree: remaining, classFolders: cf };
  }, [filtered, filter, versionSet]);

  const itemCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set("All", filtered.length);

    if (filter === "Model") {
      let localCount = 0;
      let diffusersCount = 0;
      let referenceCount = 0;
      const tagCounts = new Map<string, number>();
      const verCounts = new Map<string, number>();

      for (const item of filtered) {
        if (!isExtraNetwork(item)) continue;
        const isRef = isReferenceName(item.name);
        const isDiff = item.name.startsWith("Diffusers/");
        if (!isRef && !isDiff) localCount++;
        if (isDiff) diffusersCount++;
        if (isRef && item.tags.length === 0) referenceCount++;
        for (const cat of TAG_CATEGORIES) {
          if (itemHasTag(item, cat.toLowerCase()))
            tagCounts.set(cat, (tagCounts.get(cat) ?? 0) + 1);
        }
        if (item.version && !EXCLUDED_VERSIONS.has(item.version.toLowerCase()))
          verCounts.set(item.version, (verCounts.get(item.version) ?? 0) + 1);
      }

      if (localCount > 0) counts.set("Local", localCount);
      if (diffusersCount > 0) counts.set("Diffusers", diffusersCount);
      if (referenceCount > 0) counts.set("Reference", referenceCount);
      for (const [cat, c] of tagCounts) counts.set(cat, c);
      for (const [ver, c] of verCounts) counts.set(ver, c);
    } else if (filter === "Style") {
      let localCount = 0;
      let refCount = 0;
      for (const item of filtered) {
        if (isReferenceName(item.name)) refCount++;
        else localCount++;
      }
      if (localCount > 0) counts.set("Local", localCount);
      if (refCount > 0) counts.set("Reference", refCount);
    } else {
      for (const item of filtered) {
        if (
          isExtraNetwork(item) &&
          item.version &&
          !EXCLUDED_VERSIONS.has(item.version.toLowerCase())
        ) {
          counts.set(item.version, (counts.get(item.version) ?? 0) + 1);
        }
      }
    }

    return counts;
  }, [filtered, filter]);

  return { sidebarGroups, folderTree, classFolders, displayItems, versionSet, itemCounts };
}
