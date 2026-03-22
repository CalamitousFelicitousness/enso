export type PromptSegment =
  | { type: "text"; content: string }
  | { type: "lora"; displayName: string; weight: string; raw: string }
  | { type: "style"; name: string; raw: string }
  | { type: "wildcard"; name: string; raw: string }
  | { type: "attention"; content: string; weight: string; raw: string }
  | { type: "embedding"; name: string };

// Combined regex: angle-bracket tags | wildcards | attention weights
// Order matters — angle brackets are unambiguous and must match first.
//  1,2: <type:args>        — LoRA, LyCORIS, style
//  3:   __name__            — wildcards
//  4,5: (content:weight)    — attention weights (non-nested only)
//
// Stored as source+flags rather than a single RegExp instance to avoid the
// classic `g`-flag footgun: `test()` advances `lastIndex`, and `matchAll()`
// copies it when cloning — so a shared `g` regex leaks state between callers.
const TOKEN_PATTERN =
  /<(\w+):([^>]+)>|__(\w[\w\s/.+-]*)__|\(([^()]+):(\d+\.?\d*)\)/;
const TOKEN_FLAGS = "g";

function addTextWithEmbeddings(
  segments: PromptSegment[],
  text: string,
  embeddingRe: RegExp | null,
): void {
  if (!text) return;
  if (!embeddingRe) {
    segments.push({ type: "text", content: text });
    return;
  }

  // Reset lastIndex — the regex is reused across calls
  embeddingRe.lastIndex = 0;
  let lastIdx = 0;
  for (const m of text.matchAll(embeddingRe)) {
    const start = m.index!;
    if (start > lastIdx) {
      segments.push({ type: "text", content: text.slice(lastIdx, start) });
    }
    segments.push({ type: "embedding", name: m[0] });
    lastIdx = start + m[0].length;
  }
  if (lastIdx < text.length) {
    segments.push({ type: "text", content: text.slice(lastIdx) });
  }
}

/** Build a regex that matches any of the given embedding names as whole words.
 *  Returns null if the set is empty. Names are sorted longest-first to avoid
 *  partial matches (e.g. "easy" vs "easynegative"). */
export function buildEmbeddingRegex(names: Iterable<string>): RegExp | null {
  const sorted = Array.from(names).sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return null;
  const escaped = sorted.map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(`(?<=^|[\\s,])(?:${escaped.join("|")})(?=[\\s,]|$)`, "g");
}

export function parsePromptSegments(
  value: string,
  embeddingRe: RegExp | null = null,
): PromptSegment[] {
  const segments: PromptSegment[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(new RegExp(TOKEN_PATTERN, TOKEN_FLAGS))) {
    const matchStart = match.index!;
    if (matchStart > lastIndex) {
      addTextWithEmbeddings(
        segments,
        value.slice(lastIndex, matchStart),
        embeddingRe,
      );
    }

    if (match[1] !== undefined) {
      // Angle bracket tag: <type:args>
      const tagType = match[1].toLowerCase();
      const args = match[2];

      if (tagType === "lora" || tagType === "lyco") {
        const lastColon = args.lastIndexOf(":");
        const name = lastColon > 0 ? args.slice(0, lastColon) : args;
        const weight = lastColon > 0 ? args.slice(lastColon + 1) : "1";
        const displayName = name.split("/").pop() || name;
        segments.push({ type: "lora", displayName, weight, raw: match[0] });
      } else if (tagType === "style") {
        segments.push({ type: "style", name: args, raw: match[0] });
      } else {
        // Unknown tag type — keep as plain text
        addTextWithEmbeddings(segments, match[0], embeddingRe);
      }
    } else if (match[3] !== undefined) {
      segments.push({ type: "wildcard", name: match[3], raw: match[0] });
    } else if (match[4] !== undefined && match[5] !== undefined) {
      segments.push({
        type: "attention",
        content: match[4],
        weight: match[5],
        raw: match[0],
      });
    }

    lastIndex = matchStart + match[0].length;
  }

  if (lastIndex < value.length) {
    addTextWithEmbeddings(
      segments,
      value.slice(lastIndex),
      embeddingRe,
    );
  }

  return segments;
}

/** Quick check: does the prompt contain any syntax that benefits from chip display? */
export function hasSpecialTokens(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}
