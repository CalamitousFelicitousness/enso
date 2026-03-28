import { useMemo } from "react";
import type { ExtraNetworkV2 } from "@/api/types/models";
import type { TypeFilter, SortMode, SidebarGroup, NetworkItem, FolderNode } from "./types";
import { TAG_CATEGORIES, EXCLUDED_VERSIONS } from "./constants";
import { isExtraNetwork, isReferenceName, itemHasTag, itemPath } from "./utils";

/** Build a nested folder tree from a set of folder paths. */
function buildFolderTree(paths: Iterable<string>): FolderNode[] {
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
        node = { name: seg, path: current, children: [] };
        nodeMap.set(current, node);
        parent.push(node);
      }
      parent = node.children;
    }
  }
  return root;
}

/** Collect all folder paths (including intermediate) from item paths. */
function collectFolderPaths(
  items: NetworkItem[],
  stripPrefix?: string,
): Set<string> {
  const dirs = new Set<string>();
  for (const item of items) {
    let name = itemPath(item);
    if (stripPrefix && name.startsWith(stripPrefix)) name = name.substring(stripPrefix.length);
    const lastSlash = name.lastIndexOf("/");
    if (lastSlash <= 0) continue;
    // Add every intermediate folder path
    const folder = name.substring(0, lastSlash);
    const segments = folder.split("/");
    let path = "";
    for (const seg of segments) {
      path = path ? `${path}/${seg}` : seg;
      dirs.add(path);
    }
  }
  return dirs;
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

    if (selectedSubfolder === "All") {
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
    // "recent" — preserve server order (mtime descending from API)
    return items;
  }, [filtered, selectedSubfolder, filter, versionSet, sortMode]);

  const folderTree = useMemo((): FolderNode[] => {
    if (filter === "Style") return [];
    const stripPrefix = filter === "Model" ? "models/" : undefined;
    const relevantItems = filter === "Model"
      ? filtered.filter((item) => isExtraNetwork(item) && !isReferenceName(item.name) && !item.name.startsWith("Diffusers/"))
      : filtered;
    const paths = collectFolderPaths(relevantItems, stripPrefix);
    return buildFolderTree(paths);
  }, [filtered, filter]);

  return { sidebarGroups, folderTree, displayItems, versionSet };
}
