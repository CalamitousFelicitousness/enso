import path from "node:path";
import { Project, SyntaxKind, Node } from "ts-morph";
import type { JsxOpeningElement, JsxSelfClosingElement, JsxElement, JsxFragment } from "ts-morph";

export interface ExtractedParam {
  tab: string;
  section: string;
  param: string;
  label: string;
  keywords: string[];
  help?: string;
  /** HTML-stripped, whitespace-collapsed first ~200 chars of `help`, for fuzzy search. */
  helpExcerpt?: string;
}

export interface ExtractWarning {
  file: string;
  line: number;
  message: string;
}

export interface ExtractResult {
  params: ExtractedParam[];
  warnings: ExtractWarning[];
}

const project = new Project({
  useInMemoryFileSystem: true,
  compilerOptions: {
    jsx: 4,
    target: 99,
    allowJs: false,
  },
});

export function extractParamsFromTabFile(filePath: string, sourceText: string): ExtractResult {
  const tab = inferTabFromFilename(filePath);
  if (!tab) return { params: [], warnings: [] };

  const existing = project.getSourceFile(filePath);
  if (existing) project.removeSourceFile(existing);
  const sourceFile = project.createSourceFile(filePath, sourceText, { overwrite: true });

  const params: ExtractedParam[] = [];
  const warnings: ExtractWarning[] = [];
  const seen = new Set<string>();

  const addEntry = (entry: ExtractedParam, node: Node) => {
    const key = `${entry.tab}:${entry.section}:${entry.param}`;
    if (seen.has(key)) {
      warnings.push({
        file: filePath,
        line: node.getStartLineNumber(),
        message: `duplicate entry for ${key}`,
      });
      return;
    }
    seen.add(key);
    params.push(entry);
  };

  sourceFile.forEachDescendant((node) => {
    if (!isOpeningLike(node)) return;

    const tagName = node.getTagNameNode().getText();

    if (tagName === "ParamSlider" || tagName === "ParamRow") {
      const labelResult = readStringAttr(node, "label");
      if (labelResult.kind === "missing") return;
      if (labelResult.kind === "dynamic") {
        warnings.push({
          file: filePath,
          line: node.getStartLineNumber(),
          message: `<${tagName}> has dynamic label — skipped`,
        });
        return;
      }
      const label = labelResult.value;

      const section = findEnclosingSectionTitle(node, warnings, filePath);
      if (!section) {
        warnings.push({
          file: filePath,
          line: node.getStartLineNumber(),
          message: `<${tagName} label="${label}"> has no enclosing <SectionLeader> — skipped`,
        });
        return;
      }

      const keywordsResult = readStringArrayAttr(node, "keywords");
      const keywords = keywordsResult.kind === "ok" ? keywordsResult.value : [];
      if (keywordsResult.kind === "dynamic") {
        warnings.push({
          file: filePath,
          line: node.getStartLineNumber(),
          message: `<${tagName} label="${label}"> has dynamic keywords — defaulted to []`,
        });
      }

      const helpResult = readStringAttr(node, "tooltip");
      const help = helpResult.kind === "ok" ? helpResult.value : undefined;
      const helpExcerpt = help ? buildHelpExcerpt(help) : undefined;

      addEntry(
        {
          tab,
          section: section.toLowerCase(),
          param: label.toLowerCase(),
          label,
          keywords,
          ...(help ? { help } : {}),
          ...(helpExcerpt ? { helpExcerpt } : {}),
        },
        node,
      );
      return;
    }

    const dataParamResult = readStringAttr(node, "data-param");
    if (dataParamResult.kind !== "ok") return;
    const dataParam = dataParamResult.value;

    const section = findEnclosingSectionTitle(node, warnings, filePath);
    if (!section) {
      warnings.push({
        file: filePath,
        line: node.getStartLineNumber(),
        message: `<... data-param="${dataParam}"> has no enclosing <SectionLeader> — skipped`,
      });
      return;
    }

    const innerLabel = findInnerLabelText(node) ?? titleCase(dataParam);
    addEntry(
      {
        tab,
        section: section.toLowerCase(),
        param: dataParam.toLowerCase(),
        label: innerLabel,
        keywords: [],
      },
      node,
    );
  });

  params.sort((a, b) => {
    if (a.section !== b.section) return a.section.localeCompare(b.section);
    return a.param.localeCompare(b.param);
  });

  return { params, warnings };
}

function inferTabFromFilename(filePath: string): string | null {
  const base = path.basename(filePath, ".tsx");
  if (!base.endsWith("Tab")) return null;
  const stem = base.slice(0, -"Tab".length);
  if (!stem) return null;
  return stem.toLowerCase();
}

type OpeningLike = JsxOpeningElement | JsxSelfClosingElement;

function isOpeningLike(node: Node): node is OpeningLike {
  return Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node);
}

type AttrResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "missing" }
  | { kind: "dynamic" };

function readStringAttr(node: OpeningLike, name: string): AttrResult<string> {
  const attr = node.getAttribute(name);
  if (!attr || !Node.isJsxAttribute(attr)) return { kind: "missing" };
  const init = attr.getInitializer();
  if (!init) return { kind: "missing" };
  if (Node.isStringLiteral(init)) return { kind: "ok", value: init.getLiteralValue() };
  if (Node.isJsxExpression(init)) {
    const expr = init.getExpression();
    if (expr && Node.isStringLiteral(expr)) return { kind: "ok", value: expr.getLiteralValue() };
    if (expr && Node.isNoSubstitutionTemplateLiteral(expr)) {
      return { kind: "ok", value: expr.getLiteralValue() };
    }
  }
  return { kind: "dynamic" };
}

function readStringArrayAttr(node: OpeningLike, name: string): AttrResult<string[]> {
  const attr = node.getAttribute(name);
  if (!attr || !Node.isJsxAttribute(attr)) return { kind: "missing" };
  const init = attr.getInitializer();
  if (!init || !Node.isJsxExpression(init)) return { kind: "missing" };
  const expr = init.getExpression();
  if (!expr || !Node.isArrayLiteralExpression(expr)) return { kind: "dynamic" };
  const out: string[] = [];
  for (const el of expr.getElements()) {
    if (Node.isStringLiteral(el)) {
      out.push(el.getLiteralValue());
    } else if (Node.isNoSubstitutionTemplateLiteral(el)) {
      out.push(el.getLiteralValue());
    } else {
      return { kind: "dynamic" };
    }
  }
  return { kind: "ok", value: out };
}

function findEnclosingSectionTitle(node: Node, warnings: ExtractWarning[], file: string): string | null {
  let parent: Node | undefined = node.getParent();
  while (parent) {
    if (Node.isJsxElement(parent)) {
      const opening = parent.getOpeningElement();
      const tagName = opening.getTagNameNode().getText();
      if (tagName === "SectionLeader") {
        const title = readStringAttr(opening, "title");
        if (title.kind === "ok") return title.value;
        if (title.kind === "dynamic") {
          warnings.push({
            file,
            line: opening.getStartLineNumber(),
            message: `<SectionLeader> has dynamic title — entry will be skipped`,
          });
          return null;
        }
      }
    }
    parent = parent.getParent();
  }
  return null;
}

function findInnerLabelText(node: OpeningLike): string | undefined {
  const elementNode = node.getParent();
  if (!elementNode || !isJsxContainer(elementNode)) return undefined;

  let result: string | undefined;
  elementNode.forEachDescendant((descendant, traversal) => {
    if (result) {
      traversal.stop();
      return;
    }
    if (!isOpeningLike(descendant)) return;
    const tagName = descendant.getTagNameNode().getText();
    if (tagName !== "ParamLabel" && tagName !== "Label") return;

    const labelElement = descendant.getParent();
    const text = collectJsxText(labelElement);
    if (text) {
      result = text;
      traversal.stop();
    }
  });
  return result;
}

function isJsxContainer(node: Node | undefined): node is JsxElement | JsxFragment {
  return !!node && (Node.isJsxElement(node) || Node.isJsxFragment(node));
}

function collectJsxText(node: Node | undefined): string {
  if (!node) return "";
  const parts: string[] = [];
  const walk = (n: Node) => {
    n.forEachChild((child) => {
      if (Node.isJsxText(child)) {
        parts.push(child.getLiteralText());
      } else if (child.getKind() === SyntaxKind.SyntaxList) {
        walk(child);
      }
    });
  };
  walk(node);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

const HTML_ENTITY_MAP: Record<string, string> = {
  "&quot;": "\"",
  "&apos;": "'",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

function buildHelpExcerpt(help: string): string {
  // Strip HTML tags entirely. Replace <br> with a space first so adjacent
  // sentences don't run together.
  const noTags = help.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " ");
  const decoded = noTags.replace(/&[a-z]+;/gi, (m) => HTML_ENTITY_MAP[m.toLowerCase()] ?? m);
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, 200);
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Tokenize a label into lowercase keyword candidates. Strips punctuation,
 * splits on whitespace, drops empty tokens. "Color temp (K)" → ["color", "temp", "k"].
 */
export function deriveLabelKeywords(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[(){}[\].,;:!?]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Expand a keyword set using bidirectional synonym groups. If any keyword
 * matches a term in a group, all other terms in that group are added.
 * Comparison is case-insensitive; output is lowercase, deduped, in insertion order.
 */
export function expandSynonyms(keywords: string[], groups: string[][]): string[] {
  const result = new Set<string>(keywords.map((k) => k.toLowerCase()));
  for (const group of groups) {
    const hit = group.some((term) => result.has(term.toLowerCase()));
    if (hit) {
      for (const term of group) result.add(term.toLowerCase());
    }
  }
  return Array.from(result);
}

/**
 * Compose final keyword list for an entry: explicit + label-derived + synonym-expanded
 * (drawing from explicit keywords, label words, section, and tab). All lowercase, deduped.
 */
export function enrichKeywords(
  entry: Pick<ExtractedParam, "label" | "section" | "tab" | "keywords">,
  groups: string[][],
): string[] {
  const explicit = entry.keywords.map((k) => k.toLowerCase());
  const labelTokens = deriveLabelKeywords(entry.label);
  const seedTerms = [
    ...explicit,
    ...labelTokens,
    entry.section.toLowerCase(),
    entry.tab.toLowerCase(),
  ];
  const expanded = expandSynonyms(seedTerms, groups);
  // Preserve original explicit keyword ordering at the front for stable output.
  const ordered = new Set<string>(explicit);
  for (const k of labelTokens) ordered.add(k);
  for (const k of expanded) ordered.add(k);
  // Drop the section/tab tokens — they're already in the action's group/target.
  ordered.delete(entry.section.toLowerCase());
  ordered.delete(entry.tab.toLowerCase());
  return Array.from(ordered);
}
