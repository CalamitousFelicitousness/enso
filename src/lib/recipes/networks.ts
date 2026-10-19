// sdnext's network tags in a prompt: <lora:name>, <lora:name:te>, <lora:name:te:unet>,
// and the same with lyco. The name runs to the first colon, as sdnext reads it.

export type NetworkKind = "lora" | "lyco";

export interface NetworkTag {
  kind: NetworkKind;
  name: string;
  /** The weights after the name, as written. */
  weights: string[];
  /** The tag's span in the text. */
  from: number;
  to: number;
}

const TAG = /<(lora|lyco):([^:<>]+)((?::[^:<>]*)*)>/gi;

/** An unclosed tag ending where text ends, the part a completion replaces. */
export const PARTIAL_TAG = /<(?:lora|lyco):[^:<>]*/i;
/** What a completed name may hold. */
export const NAME_PART = /^[^:<>]*$/;

export function networkTags(text: string): NetworkTag[] {
  return [...text.matchAll(TAG)].map((match) => ({
    kind: match[1].toLowerCase() as NetworkKind,
    name: match[2],
    weights: match[3] ? match[3].slice(1).split(":") : [],
    from: match.index,
    to: match.index + match[0].length,
  }));
}

/** Each network the texts name, once, in the order met. */
export function networksIn(...texts: string[]): { kind: NetworkKind; name: string }[] {
  const seen = new Map<string, { kind: NetworkKind; name: string }>();
  for (const text of texts) {
    for (const { kind, name } of networkTags(text)) {
      const key = `${kind}:${name}`;
      if (!seen.has(key)) seen.set(key, { kind, name });
    }
  }
  return [...seen.values()];
}
