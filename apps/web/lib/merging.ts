// Pure helpers for merging and splitting contacts: which name to keep, which contact to keep, and the
// plain words shown for a suggestion or an automatic merge. No database access, so they can be unit tested.

/** What the merge screens need to know about each of the two people. */
export interface MergeSide {
  id: string;
  name: string;
  emails: string[];
  phones: string[];
  /** Has a WhatsApp chat, even when WhatsApp hides the number. */
  hasWhatsApp?: boolean;
  /** Conversations with them, used to keep the busier contact when the names do not decide it. */
  conversations?: number;
}

/** A name that is really an address or a number, the same test the database uses when it merges. */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  return n === "" || /^\+?[0-9 ().-]*$/.test(n) || /^[0-9]+@lid$/.test(n) || n.includes("@");
}

/** The words of a name in a fixed order, ignoring case, accents, punctuation and surname-first order. */
export function nameWords(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .sort();
}

/**
 * The name to keep when it is clear, or "ask" when the two are both real names that differ meaningfully.
 * A real name beats a number or an address, and "Geoff Prowse" beats "Geoff". Null means they are the
 * same name written differently, so either will do.
 */
export function preferredName(a: string, b: string): string | null | "ask" {
  const pa = isPlaceholderName(a);
  const pb = isPlaceholderName(b);
  if (pa && pb) return null;
  if (pa) return b.trim();
  if (pb) return a.trim();
  const wa = nameWords(a);
  const wb = nameWords(b);
  if (wa.join(" ") === wb.join(" ")) return null;
  const setA = new Set(wa);
  const setB = new Set(wb);
  if (wa.every((w) => setB.has(w))) return b.trim();
  if (wb.every((w) => setA.has(w))) return a.trim();
  return "ask";
}

/** True when the person should pick which of the two names to keep. */
export function namesDiffer(a: string, b: string): boolean {
  return preferredName(a, b) === "ask";
}

export interface MergePlan {
  keepId: string;
  mergeId: string;
  /** The name the kept contact should end up with, when it is not simply its own. */
  name?: string;
}

/**
 * Which contact survives. The one whose name is kept survives, so an undo gives each its own name back.
 * Otherwise the one with more conversations, then the first.
 */
export function planMerge(a: MergeSide, b: MergeSide, chosenName?: string): MergePlan {
  const preferred = chosenName?.trim() || preferredName(a.name, b.name);
  if (preferred && preferred !== "ask") {
    const byName = a.name.trim() === preferred ? a : b.name.trim() === preferred ? b : null;
    if (byName) {
      const other = byName === a ? b : a;
      return { keepId: byName.id, mergeId: other.id, name: preferred };
    }
  }
  const keepA = (a.conversations ?? 0) >= (b.conversations ?? 0);
  return keepA ? { keepId: a.id, mergeId: b.id } : { keepId: b.id, mergeId: a.id };
}

function channelsOf(c: MergeSide) {
  return { email: c.emails.length > 0, whatsapp: c.phones.length > 0 || !!c.hasWhatsApp };
}

export type SuggestionReason = "same_name" | "name_matches_address" | "same_company_name" | "shared_phone" | "other";

/** Why two people are suggested, in plain words. */
export function suggestionReasonText(reason: string, a: MergeSide, b: MergeSide, organization?: string | null): string {
  switch (reason as SuggestionReason) {
    case "same_name": {
      const ca = channelsOf(a);
      const cb = channelsOf(b);
      const onlyEmail = (c: typeof ca) => c.email && !c.whatsapp;
      const onlyWhatsApp = (c: typeof ca) => c.whatsapp && !c.email;
      if ((onlyEmail(ca) && onlyWhatsApp(cb)) || (onlyWhatsApp(ca) && onlyEmail(cb))) return "Same name on email and WhatsApp";
      if (onlyEmail(ca) && onlyEmail(cb)) return "Same name on different email addresses";
      if (onlyWhatsApp(ca) && onlyWhatsApp(cb)) return "Same name on different numbers";
      return "Same name";
    }
    case "name_matches_address":
      return "Their email address matches this name";
    case "same_company_name":
      return organization ? `Same name at ${organization}` : "Same name at the same company";
    case "shared_phone":
      return "They share a phone number";
    default:
      return "These look like the same person";
  }
}

/** Where an address book match came from, by the provider of the account whose cards matched. */
export function addressBookLabel(providers: string[]): string {
  const icloud = providers.includes("icloud");
  const google = providers.includes("gmail");
  if (icloud && !google) return "Matched by your iCloud address book";
  if (google && !icloud) return "Matched by your Google contacts";
  return "Matched by your address book";
}

/** Why a merge happened, in plain words. */
export function mergeReasonText(reason: string, providers: string[] = []): string {
  switch (reason) {
    case "address_book":
      return addressBookLabel(providers);
    case "signature":
      return "Their number is in their email signature";
    case "exact_match":
      return "The same number on both";
    case "suggestion":
      return "Merged from a suggestion";
    default:
      return "Merged by you";
  }
}

export interface IdentityRow {
  id: string;
  kind: string;
  value: string;
}

export interface IdentityGroup {
  /** Every identity that moves together: a number's phone and WhatsApp entries go as one. */
  ids: string[];
  label: string;
  detail: string;
}

/** A contact's addresses and numbers as the Split dialog lists them, one row per address or number. */
export function identityGroups(rows: IdentityRow[]): IdentityGroup[] {
  const groups = new Map<string, { ids: string[]; kinds: Set<string>; value: string }>();
  for (const r of rows) {
    const lid = r.kind === "whatsapp" && r.value.endsWith("@lid");
    // WhatsApp privacy IDs are not numbers, so they never join a number's row.
    const key = r.kind === "email" ? `email:${r.value.toLowerCase()}` : lid ? `lid:${r.value}` : `number:${r.value}`;
    const g = groups.get(key) ?? { ids: [], kinds: new Set<string>(), value: r.value };
    g.ids.push(r.id);
    g.kinds.add(r.kind);
    groups.set(key, g);
  }
  return [...groups.entries()].map(([key, g]) => {
    if (key.startsWith("email:")) return { ids: g.ids, label: g.value, detail: "Email" };
    if (key.startsWith("lid:")) return { ids: g.ids, label: "WhatsApp", detail: "Number hidden by WhatsApp" };
    const detail = g.kinds.has("whatsapp") && g.kinds.has("phone") ? "Phone and WhatsApp" : g.kinds.has("whatsapp") ? "WhatsApp" : "Phone";
    return { ids: g.ids, label: g.value, detail };
  });
}

/** Contact ids that point at the contact they were merged into, followed to the end of the chain. */
export function followMerges(id: string, mergedInto: Record<string, string | undefined>): string {
  let current = id;
  const seen = new Set<string>([current]);
  for (let next = mergedInto[current]; next && !seen.has(next); next = mergedInto[current]) {
    current = next;
    seen.add(current);
  }
  return current;
}
