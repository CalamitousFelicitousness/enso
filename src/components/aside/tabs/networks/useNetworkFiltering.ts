import { useMemo } from "react";
import type { ExtraNetworkV2 } from "@/api/types/models";
import type { TypeFilter, SortMode, SidebarGroup, NetworkItem } from "./types";
import { TAG_CATEGORIES, EXCLUDED_VERSIONS } from "./constants";
import { isExtraNetwork, isReferenceName, itemHasTag } from "./utils";

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
      const realDirs = new Set<string>();
      let hasLocal = false;
      let hasDiffusers = false;
      let hasReference = false;
      const tagHits = new Map<string, boolean>();
      for (const cat of TAG_CATEGORIES) tagHits.set(cat.toLowerCase(), false);

      for (const item of filtered) {
        if (!isExtraNetwork(item)) continue;
        const isRef = isReferenceName(item.name);
        const isDiff = item.name.startsWith("Diffusers/");
        if (!isRef && !isDiff) {
          hasLocal = true;
          const name = item.name.startsWith("models/")
            ? item.name.substring(7)
            : item.name;
          const slash = name.indexOf("/");
          if (slash > 0) realDirs.add(name.substring(0, slash));
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
      const dirs = Array.from(realDirs).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );

      const groups: SidebarGroup[] = [{ items: ["All", ...categories] }];
      if (sortedVersions.length > 0)
        groups.push({ header: "Class", items: sortedVersions });
      if (dirs.length > 0) groups.push({ header: "Folders", items: dirs });
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
    const dirs = new Set<string>();
    for (const item of filtered) {
      const slash = item.name.indexOf("/");
      if (slash > 0) dirs.add(item.name.substring(0, slash));
    }
    const sortedDirs = Array.from(dirs).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );

    const groups: SidebarGroup[] = [{ items: ["All", ...sortedDirs] }];
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
          items = filtered.filter(
            (item) =>
              item.name.startsWith(prefix) || item.name.startsWith(altPrefix),
          );
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
      items = filtered.filter((item) => item.name.startsWith(prefix));
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

  return { sidebarGroups, displayItems, versionSet };
}
