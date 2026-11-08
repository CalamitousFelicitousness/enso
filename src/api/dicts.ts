// The page's side of the dictionary worker: the enabled dictionaries go to
// it, and lookups come back from it.

import { api } from "./client";
import type { DictsRequest, DictsResponse } from "./dicts.worker";
import type { TagMatch } from "@/lib/dicts/tags";

let worker: Worker | null = null;
let enabled = "";
let nextId = 0;
const waiting = new Map<number, (tags: TagMatch[]) => void>();

function start(): Worker {
  const started = new Worker(new URL("./dicts.worker.ts", import.meta.url), { type: "module" });
  started.addEventListener("message", (event: MessageEvent<DictsResponse>) => {
    const answer = event.data;
    if (answer.type === "result") {
      waiting.get(answer.id)?.(answer.tags);
      waiting.delete(answer.id);
      return;
    }
    for (const { name, message } of answer.failed) {
      console.warn(`[dicts] the ${name} dictionary could not be loaded: ${message}`);
    }
  });
  started.addEventListener("error", (event) => {
    console.error("[dicts] the dictionary worker failed; autocomplete has no tags", event.message);
    started.terminate();
    worker = null;
    enabled = "";
    for (const resolve of waiting.values()) resolve([]);
    waiting.clear();
  });
  return started;
}

/** Load these dictionaries, merged, in place of the ones before; the same
 * list again does nothing. */
export function enableDicts(names: readonly string[]): void {
  const key = names.join("\n");
  if (key === enabled) return;
  enabled = key;
  if (!worker && names.length === 0) return;
  worker ??= start();
  worker.postMessage({
    type: "load",
    names: [...names],
    baseUrl: api.getBaseUrl(),
    authorization: api.getAuthorization(),
  } satisfies DictsRequest);
}

/** Up to `limit` tags for what was typed, best first; none until the dictionaries are in. */
export function lookupDictTags(text: string, limit: number): Promise<TagMatch[]> {
  const current = worker;
  if (!current) return Promise.resolve([]);
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    current.postMessage({ type: "query", id, text, limit } satisfies DictsRequest);
  });
}
