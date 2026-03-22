import { hoverTooltip, type Tooltip, type EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { api } from "@/api/client";
import type { NetworkDetail } from "@/api/types/models";
import {
  TOKEN_PATTERN,
  embeddingNamesFacet,
  loraNamesFacet,
  styleNamesFacet,
} from "./facets";

function getCivitInfo(info: Record<string, unknown> | null | undefined) {
  if (!info || typeof info.id !== "number" || info.id <= 0) return null;
  const versions = Array.isArray(info.modelVersions)
    ? (info.modelVersions as Array<Record<string, unknown>>)
    : [];
  const firstVersion = versions[0];
  const trainedWords = Array.isArray(firstVersion?.trainedWords)
    ? (firstVersion.trainedWords as string[]).filter(Boolean)
    : [];
  const baseModel =
    typeof firstVersion?.baseModel === "string"
      ? firstVersion.baseModel
      : null;
  return {
    id: info.id as number,
    name: typeof info.name === "string" ? info.name : null,
    trainedWords,
    baseModel,
  };
}

function makeRow(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "cm-tooltip-token-detail";
  row.textContent = `${label}: ${value}`;
  return row;
}

function loraTooltip(
  view: EditorView,
  name: string,
  weight: string,
  from: number,
  to: number,
): Tooltip {
  // Get preview from already-loaded facet data
  const loraItems = view.state.facet(loraNamesFacet);
  const loraItem = loraItems.find((l) => l.name === name);
  return {
    pos: from,
    end: to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-tooltip-token";

      const title = document.createElement("div");
      title.className = "cm-tooltip-token-name";
      title.textContent = name.split("/").pop() || name;
      dom.appendChild(title);

      if (name.includes("/")) {
        dom.appendChild(makeRow("Path", name));
      }
      dom.appendChild(makeRow("Weight", weight));

      // Preview image from already-loaded facet data
      if (loraItem?.preview) {
        const img = document.createElement("img");
        img.src = loraItem.preview;
        dom.insertBefore(img, dom.firstChild);
      }

      const loading = document.createElement("div");
      loading.className = "cm-tooltip-token-detail";
      loading.textContent = "Loading details…";
      dom.appendChild(loading);

      // Async fetch CivitAI metadata
      api
        .get<NetworkDetail>("/sdapi/v2/extra-networks/detail", {
          page: "lora",
          name,
        })
        .then((detail) => {
          loading.remove();
          const civit = getCivitInfo(detail.info);
          if (civit?.baseModel) {
            dom.appendChild(makeRow("Base", civit.baseModel));
          }
          if (civit?.trainedWords.length) {
            const tags = document.createElement("div");
            tags.className = "cm-tooltip-token-tags";
            tags.textContent = civit.trainedWords.slice(0, 8).join(", ");
            dom.appendChild(tags);
          }
          // Remove loading if no extra info found
          if (!civit?.baseModel && !civit?.trainedWords.length) {
            // nothing extra to show
          }
        })
        .catch(() => {
          loading.textContent = "";
        });

      return { dom };
    },
  };
}

function styleTooltip(name: string, from: number, to: number, styles: import("@/api/types/models").PromptStyleV2[]): Tooltip {
  const style = styles.find((s) => s.name === name);
  return {
    pos: from,
    end: to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-tooltip-token";

      const title = document.createElement("div");
      title.className = "cm-tooltip-token-name";
      title.textContent = name;
      dom.appendChild(title);

      if (style?.prompt) {
        const preview = document.createElement("div");
        preview.className = "cm-tooltip-token-detail";
        preview.textContent =
          style.prompt.length > 120
            ? style.prompt.slice(0, 120) + "…"
            : style.prompt;
        dom.appendChild(preview);
      }
      if (style?.description) {
        dom.appendChild(makeRow("", style.description.slice(0, 80)));
      }

      return { dom };
    },
  };
}

function wildcardTooltip(name: string, from: number, to: number): Tooltip {
  return {
    pos: from,
    end: to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-tooltip-token";
      const title = document.createElement("div");
      title.className = "cm-tooltip-token-name";
      title.textContent = `Wildcard: ${name}`;
      dom.appendChild(title);
      return { dom };
    },
  };
}

function embeddingTooltip(name: string, from: number, to: number): Tooltip {
  return {
    pos: from,
    end: to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-tooltip-token";
      const title = document.createElement("div");
      title.className = "cm-tooltip-token-name";
      title.textContent = `Embedding: ${name}`;
      dom.appendChild(title);
      return { dom };
    },
  };
}

export function promptTooltips(): Extension {
  return hoverTooltip(
    (view, pos) => {
      const doc = view.state.doc.toString();

      // Check syntax-based tokens
      for (const match of doc.matchAll(new RegExp(TOKEN_PATTERN, "g"))) {
        const from = match.index!;
        const to = from + match[0].length;
        if (pos < from || pos >= to) continue;

        if (match[1] !== undefined) {
          const tagType = match[1].toLowerCase();
          const args = match[2];
          if (tagType === "lora" || tagType === "lyco") {
            const lastColon = args.lastIndexOf(":");
            const name = lastColon > 0 ? args.slice(0, lastColon) : args;
            const weight = lastColon > 0 ? args.slice(lastColon + 1) : "1";
            return loraTooltip(view, name, weight, from, to);
          }
          if (tagType === "style") {
            const styles = view.state.facet(styleNamesFacet);
            return styleTooltip(args, from, to, styles);
          }
        } else if (match[3] !== undefined) {
          return wildcardTooltip(match[3], from, to);
        }
        // Attention weights don't need tooltips
        return null;
      }

      // Check embeddings
      const embeddings = view.state.facet(embeddingNamesFacet);
      if (embeddings.length > 0) {
        const sorted = [...embeddings].sort((a, b) => b.length - a.length);
        const escaped = sorted.map((n) =>
          n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        );
        const re = new RegExp(
          `(?<=^|[\\s,])(?:${escaped.join("|")})(?=[\\s,]|$)`,
          "g",
        );
        for (const m of doc.matchAll(re)) {
          const from = m.index!;
          const to = from + m[0].length;
          if (pos >= from && pos < to) {
            return embeddingTooltip(m[0], from, to);
          }
        }
      }

      return null;
    },
    { hoverTime: 300 },
  );
}
