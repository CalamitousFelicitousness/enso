// Which sent pictures answer to another number after a change to the list.
// Renumbering cannot be prevented, only made unmistakable.

import type { Address, SentInput } from "./outline";

export interface AddressChange {
  frameId: string;
  pictureId: string | null;
  from: Address;
  to: Address;
}

const identity = (input: SentInput) => `${input.frameId}/${input.pictureId ?? ""}`;

/** The pictures sent before and after whose number differs, in the new order. */
export function addressChanges(before: SentInput[], after: SentInput[]): AddressChange[] {
  const was = new Map(before.map((s) => [identity(s), s.address]));
  return after.flatMap((input): AddressChange[] => {
    const from = was.get(identity(input));
    if (!from || (from.kind === input.address.kind && from.n === input.address.n)) return [];
    return [{ frameId: input.frameId, pictureId: input.pictureId, from, to: input.address }];
  });
}
