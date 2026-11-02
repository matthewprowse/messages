// The text Suggest Times puts in the reply box: three free times from your calendar, one a line. The slots come from
// freeSlots (choices.ts), the same code Suggest Another Time uses. Pure.

import { slotLabel } from "./choices";

/** "A few times that work for me:" and each slot on its own line. Empty when there are none. */
export function suggestTimesText(slots: Date[]): string {
  if (slots.length === 0) return "";
  return `A few times that work for me:\n\n${slots.map(slotLabel).join("\n")}`;
}

/** Puts text below what is already in the box, after a blank line. */
export function addBelow(existing: string, added: string): string {
  return existing.trim() ? `${existing.trimEnd()}\n\n${added}` : added;
}
