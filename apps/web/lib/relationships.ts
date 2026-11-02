// The relationship a contact has to you: a fixed set to pick from, plus anything typed, and the Contacts list filter
// by it. Stored as plain text (sealed like the rest), so a value that is not in the set is simply a custom one. Pure.

export const RELATIONSHIPS = ["Client", "Prospect", "Colleague", "Supplier", "Personal", "Other"] as const;

/** The longest relationship the database takes (update_contact allows 60 characters before it is sealed). */
export const MAX_RELATIONSHIP = 60;

/** What the list filter shows for every relationship. */
export const ALL_RELATIONSHIPS = "all";

/** A typed value in the spelling of the set when it matches one ("client" gives "Client"), else trimmed as typed. */
export function canonicalRelationship(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  return RELATIONSHIPS.find((r) => r.toLowerCase() === text.toLowerCase()) ?? text;
}

/** Whether a value is one of the set (any case). Anything else, including empty, is custom. */
export function isStandardRelationship(value: string | null | undefined): boolean {
  return RELATIONSHIPS.some((r) => r === canonicalRelationship(value));
}

/** Whether the contact is a client, which is what Going Quiet watches besides starred people. */
export function isClient(relationship: string | null | undefined): boolean {
  return canonicalRelationship(relationship) === "Client";
}

/** The filter's choices: the set, then any custom relationship in use (alphabetical), each once whatever its case. */
export function relationshipOptions(contacts: { relationship?: string | null }[]): string[] {
  const custom = new Map<string, string>(); // by lower case, so "Family" and "family" are one choice
  for (const c of contacts) {
    const r = canonicalRelationship(c.relationship);
    if (r && !isStandardRelationship(r) && !custom.has(r.toLowerCase())) custom.set(r.toLowerCase(), r);
  }
  return [...RELATIONSHIPS, ...[...custom.values()].sort((a, b) => a.localeCompare(b, "en-ZA", { sensitivity: "base" }))];
}

/** Whether a contact passes the filter: "all" lets everyone through, otherwise the relationship must match (any case). */
export function matchesRelationship(contact: { relationship?: string | null }, filter: string): boolean {
  if (!filter || filter === ALL_RELATIONSHIPS) return true;
  return canonicalRelationship(contact.relationship).toLowerCase() === filter.toLowerCase();
}
