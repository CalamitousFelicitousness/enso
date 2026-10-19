// The name a new recipe takes until the user gives it one, and the words a
// restore names its source by.

import { stamp } from "@/lib/inputs/library";
import { NAME_MAX } from "@/lib/media/entry";
import { networkTags } from "./networks";

/** About the length a card shows on one line. */
const PROMPT_CHARS = 40;

/** The prompt's opening words without network tags, cut at a word near
 * PROMPT_CHARS; empty for a prompt of tags alone. */
export function promptOpening(prompt: string): string {
  let text = prompt;
  for (const tag of networkTags(prompt).reverse())
    text = text.slice(0, tag.from) + text.slice(tag.to);
  text = text.replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "");
  if ([...text].length <= PROMPT_CHARS) return text;
  const cut = [...text].slice(0, PROMPT_CHARS + 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > PROMPT_CHARS / 2 ? cut.slice(0, space) : cut.slice(0, -1)).replace(/[\s,]+$/, "")}...`;
}

/** The prompt's opening words; with no prompt, "Recipe" and when it was
 * saved. A name the library already holds takes " (2)", " (3)" and so on. */
export function defaultRecipeName(
  prompt: string,
  now: number,
  timeZone: string,
  taken: ReadonlySet<string> = new Set(),
): string {
  const base = [...(promptOpening(prompt) || `Recipe ${stamp(now, timeZone)}`)]
    .slice(0, NAME_MAX - 5)
    .join("");
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const name = `${base} (${n})`;
    if (!taken.has(name)) return name;
  }
}
