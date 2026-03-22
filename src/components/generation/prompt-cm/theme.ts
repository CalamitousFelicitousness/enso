import { EditorView } from "@codemirror/view";

export const promptTheme = EditorView.theme({
  "&": {
    fontSize: "var(--text-3xs)",
    fontFamily: "var(--font-sans)",
    backgroundColor: "transparent",
    height: "100%",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
    padding: "0.5rem 0.625rem",
    fontFamily: "inherit",
    lineHeight: "1.5",
  },
  ".cm-content": {
    padding: "0",
    caretColor: "var(--color-foreground)",
  },
  ".cm-line": {
    padding: "0",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--color-foreground)",
    borderLeftWidth: "1.5px",
  },
  ".cm-selectionBackground": {
    backgroundColor:
      "color-mix(in srgb, var(--color-primary) 20%, transparent) !important",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-placeholder": {
    color: "color-mix(in srgb, var(--color-muted-foreground) 40%, transparent)",
  },

  // ── Bracket matching ──
  ".cm-matchingBracket": {
    backgroundColor:
      "color-mix(in srgb, var(--color-primary) 15%, transparent)",
    outline:
      "1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)",
    borderRadius: "1px",
  },
  ".cm-nonmatchingBracket": {
    backgroundColor:
      "color-mix(in srgb, var(--color-destructive) 15%, transparent)",
    color: "var(--color-destructive)",
  },

  // ── Token styles ──
  ".cm-tok-lora": {
    backgroundColor:
      "color-mix(in srgb, var(--color-primary) 10%, transparent)",
    color:
      "color-mix(in srgb, var(--color-primary) 90%, var(--color-foreground))",
    borderRadius: "2px",
    fontWeight: "500",
    padding: "0 3px",
    margin: "0 1px",
  },
  ".cm-tok-style": {
    backgroundColor: "color-mix(in srgb, #8b5cf6 10%, transparent)",
    color: "#a78bfa",
    borderRadius: "2px",
    fontWeight: "500",
    padding: "0 3px",
    margin: "0 1px",
  },
  ".cm-tok-wildcard": {
    backgroundColor: "color-mix(in srgb, #f59e0b 10%, transparent)",
    color: "color-mix(in srgb, #fbbf24 90%, var(--color-foreground))",
    borderRadius: "2px",
    fontWeight: "500",
    padding: "0 3px",
    margin: "0 1px",
  },
  ".cm-tok-attention": {
    backgroundColor:
      "color-mix(in srgb, var(--color-foreground) 4%, transparent)",
    borderRadius: "2px",
    padding: "0 3px",
    margin: "0 1px",
  },
  ".cm-tok-embedding": {
    backgroundColor: "color-mix(in srgb, #10b981 10%, transparent)",
    color: "color-mix(in srgb, #34d399 90%, var(--color-foreground))",
    borderRadius: "2px",
    fontWeight: "500",
    padding: "0 3px",
    margin: "0 1px",
  },
  ".cm-tok-dim": {
    opacity: "0.4",
  },

  // ── LoRA chip widget ──
  ".cm-lora-chip": {
    display: "inline",
    padding: "0 5px",
    borderRadius: "3px",
    backgroundColor:
      "color-mix(in srgb, var(--color-primary) 12%, transparent)",
    color:
      "color-mix(in srgb, var(--color-primary) 90%, var(--color-foreground))",
    fontWeight: "500",
    fontSize: "inherit",
    lineHeight: "inherit",
    verticalAlign: "baseline",
    cursor: "text",
  },
  ".cm-lora-chip-weight": {
    opacity: "0.5",
    fontFamily: "var(--font-mono)",
    fontSize: "0.85em",
    marginLeft: "2px",
  },

  // ── Autocomplete dropdown ──
  ".cm-tooltip-autocomplete": {
    backdropFilter: "blur(16px)",
    backgroundColor:
      "color-mix(in srgb, var(--color-popover) 80%, transparent)",
    border:
      "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)",
    borderRadius: "6px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
    outline:
      "1px solid color-mix(in srgb, white 5%, transparent)",
  },
  ".cm-tooltip-autocomplete ul": {
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-3xs)",
  },
  ".cm-tooltip-autocomplete ul li": {
    padding: "3px 8px",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor:
      "color-mix(in srgb, var(--color-primary) 15%, transparent)",
    color: "var(--color-foreground)",
  },
  ".cm-completionIcon-lora::after": {
    content: '"◆"',
    color: "var(--color-primary)",
  },
  ".cm-completionIcon-style::after": {
    content: '"◇"',
    color: "#a78bfa",
  },
  ".cm-completionIcon-wildcard::after": {
    content: '"✦"',
    color: "#fbbf24",
  },
  ".cm-completionIcon-embedding::after": {
    content: '"●"',
    color: "#34d399",
  },
  ".cm-completionDetail": {
    opacity: "0.5",
    fontStyle: "normal",
    marginLeft: "8px",
  },

  // ── Hover tooltip ──
  ".cm-tooltip-token": {
    backdropFilter: "blur(16px)",
    backgroundColor:
      "color-mix(in srgb, var(--color-popover) 80%, transparent)",
    border:
      "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)",
    borderRadius: "6px",
    padding: "8px 10px",
    maxWidth: "280px",
    fontSize: "var(--text-3xs)",
    fontFamily: "var(--font-sans)",
    boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
    outline:
      "1px solid color-mix(in srgb, white 5%, transparent)",
    color: "var(--color-foreground)",
  },
  ".cm-tooltip-token img": {
    width: "100%",
    maxHeight: "120px",
    objectFit: "cover",
    borderRadius: "4px",
    marginBottom: "6px",
  },
  ".cm-tooltip-token-name": {
    fontWeight: "500",
    marginBottom: "2px",
  },
  ".cm-tooltip-token-detail": {
    opacity: "0.6",
    fontSize: "0.9em",
  },
  ".cm-tooltip-token-tags": {
    opacity: "0.5",
    fontSize: "0.85em",
    marginTop: "4px",
  },

  // ── Weight slider popover ──
  ".cm-weight-slider": {
    backdropFilter: "blur(16px)",
    backgroundColor:
      "color-mix(in srgb, var(--color-popover) 85%, transparent)",
    border:
      "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)",
    borderRadius: "6px",
    padding: "6px 10px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
    outline:
      "1px solid color-mix(in srgb, white 5%, transparent)",
  },
  ".cm-weight-slider input[type=range]": {
    width: "100px",
    accentColor: "var(--color-primary)",
  },
  ".cm-weight-slider-label": {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-3xs)",
    color: "var(--color-foreground)",
    minWidth: "2.5em",
    textAlign: "right",
  },
});
