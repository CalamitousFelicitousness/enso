import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import { Copy, Trash2, WrapText, Filter } from "lucide-react";
import { useServerLog, useClearLog } from "@/api/hooks/useLog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ParsedLine {
  time: string;
  level: string;
  module: string;
  func: string;
  msg: string;
  raw: string;
}

const LEVEL_CLASSES: Record<string, string> = {
  CRITICAL: "text-red-400",
  ERROR: "text-red-400",
  WARNING: "text-yellow-400",
  INFO: "text-blue-400",
  DEBUG: "text-muted-foreground/70",
  TRACE: "text-muted-foreground/50",
};

const LEVEL_ORDER = ["TRACE", "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];

function parseLine(raw: string): ParsedLine {
  try {
    const obj = JSON.parse(raw) as Record<string, string>;
    const asctime = obj.asctime ?? "";
    const timePart = asctime.includes(" ") ? asctime.split(" ")[1] ?? asctime : asctime;
    const time = timePart.replace(",", ".");
    return {
      time,
      level: obj.level ?? "",
      module: obj.module ?? "",
      func: obj.func ?? "",
      msg: obj.msg ?? "",
      raw,
    };
  } catch {
    return { time: "", level: "", module: "", func: "", msg: raw, raw };
  }
}

// Tokenize log message into highlighted spans
// Patterns matched (in priority order):
//   1. Quoted strings: 'value' or "value"
//   2. Key=value pairs: key=number, key=word, key='quoted'
//   3. Standalone numbers (with optional units like MB, GB, s)
//   4. HTTP methods: GET, POST, PUT, DELETE, PATCH
//   5. URL paths: /sdapi/v2/... or http://...
const MSG_TOKEN_RE =
  /('[^']*'|"[^"]*")|(\b\w+=(?:'[^']*'|"[^"]*"|\[[^\]]*\]|\{[^}]*\}|[\w./:~-]+))|(\b(?:GET|POST|PUT|DELETE|PATCH)\b)|((?:https?:\/\/|\/(?:sdapi|enso|home))\S+)|(\b\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?(?:\s*(?:MB|GB|KB|ms|s|px))?\b)/g;

function highlightMsg(msg: string): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of msg.matchAll(MSG_TOKEN_RE)) {
    const idx = match.index;
    // Push plain text before this match
    if (idx > lastIndex) {
      parts.push(msg.slice(lastIndex, idx));
    }

    const [full, quoted, keyval, method, path, num] = match;

    if (quoted) {
      parts.push(
        <span key={key++} className="text-amber-400/80">{full}</span>
      );
    } else if (keyval) {
      const eqIdx = keyval.indexOf("=");
      const k = keyval.slice(0, eqIdx);
      const v = keyval.slice(eqIdx + 1);
      parts.push(
        <span key={key++}>
          <span className="text-muted-foreground/60">{k}</span>
          <span className="text-muted-foreground/40">=</span>
          <span className="text-emerald-400/80">{v}</span>
        </span>
      );
    } else if (method) {
      parts.push(
        <span key={key++} className="text-violet-400/80">{full}</span>
      );
    } else if (path) {
      parts.push(
        <span key={key++} className="text-sky-400/70">{full}</span>
      );
    } else if (num) {
      parts.push(
        <span key={key++} className="text-orange-300/80">{full}</span>
      );
    } else {
      parts.push(full);
    }

    lastIndex = idx + full.length;
  }

  // Remaining plain text
  if (lastIndex < msg.length) {
    parts.push(msg.slice(lastIndex));
  }

  return parts.length > 0 ? parts : msg;
}

export function ConsoleTab() {
  const { data: lines } = useServerLog(200);
  const clearLog = useClearLog();
  const [wrap, setWrap] = useState(false);
  const [minLevel, setMinLevel] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  const parsed = useMemo(() => {
    if (!lines) return [];
    return lines.map(parseLine);
  }, [lines]);

  const filtered = useMemo(() => {
    if (minLevel === 0) return parsed;
    const threshold = LEVEL_ORDER[minLevel];
    const thresholdIdx = LEVEL_ORDER.indexOf(threshold);
    return parsed.filter((l) => {
      const idx = LEVEL_ORDER.indexOf(l.level);
      return idx === -1 || idx >= thresholdIdx;
    });
  }, [parsed, minLevel]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && autoScroll.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [filtered]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  async function handleCopy() {
    if (filtered.length) {
      const text = filtered
        .map((l) => (l.time ? `${l.time} ${l.level.padEnd(8)} ${l.module}:${l.func}  ${l.msg}` : l.raw))
        .join("\n");
      await navigator.clipboard.writeText(text);
    }
  }

  function cycleLevel() {
    setMinLevel((prev) => (prev + 1) % LEVEL_ORDER.length);
  }

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
        <Button
          variant="toggle"
          size="icon-xs"
          data-state={wrap ? "on" : "off"}
          onClick={() => setWrap(!wrap)}
          title="Toggle line wrap"
        >
          <WrapText className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={cycleLevel}
          title={`Filter: ${LEVEL_ORDER[minLevel]}+`}
        >
          <Filter className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleCopy}
          title="Copy all"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => clearLog.mutate()}
          title="Clear log"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <span className="ml-auto text-3xs text-muted-foreground font-mono tabular-nums">
          {minLevel > 0 && (
            <span className="mr-1.5 text-foreground/60">{LEVEL_ORDER[minLevel]}+</span>
          )}
          {filtered.length} lines
        </span>
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-muted/30 font-mono text-3xs min-w-0"
      >
        {filtered.map((line, i) => (
          <div
            key={i}
            className={cn(
              "flex px-2 hover:bg-muted/50",
              wrap ? "flex-wrap gap-x-1.5 items-baseline leading-4" : "flex-nowrap gap-1.5 overflow-hidden h-4 items-center",
            )}
          >
            {line.time ? (
              <>
                <span className="text-muted-foreground/50 shrink-0 tabular-nums whitespace-nowrap">
                  {line.time}
                </span>
                <span className={cn("shrink-0 w-12 whitespace-nowrap", LEVEL_CLASSES[line.level])}>
                  {line.level}
                </span>
                <span className="text-muted-foreground/60 shrink-0 whitespace-nowrap">
                  {line.module}
                  {line.func && `:${line.func}`}
                </span>
                <span className={cn("text-foreground/90 min-w-0", wrap ? "flex-1 break-all" : "truncate")}>
                  {highlightMsg(line.msg)}
                </span>
              </>
            ) : (
              <span className={cn("text-foreground/90 min-w-0", wrap ? "flex-1 break-all" : "truncate")}>
                {highlightMsg(line.raw)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
