// The Tidy Up card on Contacts: possible duplicates waiting for a decision and people who only have a number or an address
// for a name, counted together. Pure.

import { plural } from "./contact-list-helpers";
import { isPlaceholderName } from "./merging";

/** The contacts that still need a name: listed under People (not hidden, not a company) with a name that is only a number or an address. */
export function unnamedContacts<T extends { name: string; hidden: boolean; isCompany: boolean }>(contacts: T[]): T[] {
  return contacts.filter((c) => !c.hidden && !c.isCompany && isPlaceholderName(c.name));
}

/** What the card says. `pairs` is the number of pending merge suggestions; `more` is true when the first page of them was cut off. */
export function tidyCounts(contacts: { name: string; hidden: boolean; isCompany: boolean }[], pairs: number, more = false) {
  const unnamed = unnamedContacts(contacts).length;
  const parts = [pairs > 0 ? `${plural(pairs, "possible duplicate")}` : "", unnamed > 0 ? `${plural(unnamed, "contact")} without a name` : ""].filter(Boolean);
  return { total: pairs + unnamed, more, unnamed, pairs, detail: parts.join(" and ") };
}
