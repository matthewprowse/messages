// Which contacts are the same person. Certain pairs are merged automatically; likely pairs are suggested
// for a one-click merge.
// Pure functions, so they can be unit tested.
//
// Certain:
//   address_book  an address book card holds addresses or numbers of two or more contacts
//   signature     a number in the email signatures of exactly one contact is another contact's number
//                 (a number in the signatures of two or more people is a shared office number: unused)
//   exact_match   the same number or address on two contacts (a 'phone' and a 'whatsapp' identity)
// Likely:
//   same_name             the same full name of two or more words
//   name_matches_address  an email address made of a contact's name (geoff.prowse@ and "Geoff Prowse")
//   same_company_name     the same name at the same organization
// Never: your own addresses and numbers, role addresses (info@, noreply@), two people seen in the same
// group chat, or a pair you kept apart.

import { push } from "../util";
import { toE164 } from "./signature-phones";

export type CertainReason = "address_book" | "signature" | "exact_match";
export type SuggestionReason = "same_name" | "name_matches_address" | "same_company_name" | "shared_phone" | "other";

export interface MatchContact {
  id: string;
  name: string;
  organizationId: string | null;
}

export interface MatchIdentity {
  id: string;
  contactId: string;
  kind: string;
  value: string;
}

export interface MatchCard {
  name?: string | null;
  emails: string[];
  phones: string[];
}

/** One number found in the signature of an email from one contact. */
export interface SignaturePhone {
  contactId: string;
  phone: string;
}

export interface MatchInput {
  contacts: MatchContact[];
  identities: MatchIdentity[];
  cards: MatchCard[];
  signaturePhones: SignaturePhone[];
  /** Your own addresses (lowercase) and numbers (E.164). */
  own: string[];
  /** Pairs you kept apart. */
  dismissed: [string, string][];
  /** Contacts seen in each group chat: any two in the same group are different people. */
  groups: string[][];
  /** The country code for local numbers. */
  countryCode: string;
}

export interface CertainEdge {
  a: string;
  b: string;
  reason: CertainReason;
  evidence: Record<string, string | number>;
  /** For address_book edges: every contact the card matched. */
  cardContacts?: string[];
}

/** Contacts that are one person, and the edges that tie them together. */
export interface CertainCluster {
  contacts: string[];
  edges: CertainEdge[];
}

export interface Suggestion {
  /** contactA < contactB */
  contactA: string;
  contactB: string;
  reason: SuggestionReason;
  evidence: Record<string, string | number>;
  score: number;
}

export interface MatchResult {
  certain: CertainCluster[];
  suggestions: Suggestion[];
  /** Counts of what was held back and why, for the log. */
  skipped: {
    own: number;
    role: number;
    kept_apart: number;
    group: number;
    shared_numbers: number;
    large_cards: number;
    /** Addresses or numbers on the cards of two or more different people (a shared home or office line). */
    shared_card_keys: number;
    /** Joins refused because they would put two different people's email contacts, or too many contacts, together. */
    conflicts: number;
  };
}

/** A card that matches more contacts than this is a company or household card, not one person. */
const MAX_CARD_CONTACTS = 4;
/** More contacts than this with one name is a common name or a placeholder, not one person. */
const MAX_NAME_GROUP = 4;
/** One person is rarely more than this many contacts (two addresses, a phone and a WhatsApp contact). */
const MAX_CLUSTER = 4;

const ROLE_LOCAL =
  /^(no-?reply|do-?not-?reply|donotreply|noreply[-.+_].*|.*[-.+_]no-?reply|info|support|help|helpdesk|hello|hi|team|notifications?|notify|alerts?|updates?|news|newsletters?|marketing|mailer-daemon|postmaster|bounces?|admin|administrator|office|reception|contact|contactus|enquiries|enquiry|inquiries|inquiry|sales|billing|accounts|accounting|finance|invoices?|orders?|receipts?|bookings?|reservations?|service|customerservice|customercare|care|feedback|security|privacy|legal|hr|jobs|careers|recruitment|press|media|webmaster|root|system|automated|auto|robot|bot|calendar|members?|community|events?|mail|email|general|online|shop|store|digest)$/i;

/** An address for a role or a robot rather than a person: noreply@, info@, support@ and the like. */
export function isRoleAddress(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0) return false;
  const raw = email.slice(0, at).toLowerCase();
  const local = raw.replace(/\+.*$/, "").replace(/_/g, "-"); // hello+news, no_reply
  if (ROLE_LOCAL.test(raw) || ROLE_LOCAL.test(local)) return true;
  if (/^(bounce|mailer|noreply|no-reply|notification)/.test(local)) return true;
  if (/(^|[-.])(no-?reply|do-?not-?(reply|respond))([-.]|$)/.test(local)) return true;
  // info.za, support-za, accounts-payable: a role word first.
  const first = local.split(/[-.]/)[0];
  return first.length >= 3 && first !== local && ROLE_LOCAL.test(first);
}

/** A name that is really a number, a WhatsApp privacy ID or an address. */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const t = (name ?? "").trim();
  return !t || /^\+?[\d\s().\-]*$/.test(t) || /^\d+@lid$/.test(t) || t.includes("@");
}

const TITLES = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "prof", "sir", "dame", "jr", "sr", "ii", "iii", "phd", "md"]);

/** A name's words, lowercase, without accents, punctuation or titles, in the order written. */
export function nameWords(name: string | null | undefined): string[] {
  if (isPlaceholderName(name)) return [];
  let s = (name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  s = s.replace(/\(.*?\)/g, " "); // "Geoff (work)"
  const comma = s.split(",");
  if (comma.length === 2 && comma[0].trim() && comma[1].trim()) s = `${comma[1]} ${comma[0]}`; // "Prowse, Geoff"
  s = s.replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ");
  return s.split(" ").filter((w) => w && !TITLES.has(w) && !/^\d+$/.test(w));
}

/**
 * The key two names share when they are the same name: words sorted, so "Prowse Geoff" (surname first)
 * equals "Geoff Prowse". Null for a placeholder or an empty name.
 */
export function nameKey(name: string | null | undefined): string | null {
  const words = nameWords(name);
  return words.length ? [...words].sort().join(" ") : null;
}

/** A full name: two or more words of two or more letters. */
function isFullName(words: string[]): boolean {
  return words.filter((w) => w.length >= 2).length >= 2;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The two IDs, smaller first, as a pair is stored. */
export function ordered(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** The key an identity is matched on: a lowercase address or an E.164 number. Privacy IDs have none. */
export function identityKey(kind: string, value: string, countryCode: string): string | null {
  if (kind === "email") return value.includes("@") ? `e:${value.trim().toLowerCase()}` : null;
  if (kind === "phone" || kind === "whatsapp") {
    if (value.includes("@")) return null; // "...@lid" is a privacy ID, never a number
    const e164 = toE164(value, countryCode);
    return e164 ? `p:${e164}` : null;
  }
  return null;
}

class Clusters {
  private parent = new Map<string, string>();
  private members = new Map<string, Set<string>>();

  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    while (p !== (this.parent.get(p) ?? p)) p = this.parent.get(p) ?? p;
    if (p !== x) this.parent.set(x, p);
    return p;
  }

  setOf(x: string): Set<string> {
    return this.members.get(this.find(x)) ?? new Set([x]);
  }

  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const merged = new Set([...this.setOf(ra), ...this.setOf(rb)]);
    this.parent.set(rb, ra);
    this.members.set(ra, merged);
    this.members.delete(rb);
  }
}

const REASON_ORDER: CertainReason[] = ["address_book", "exact_match", "signature"];

export function findMatches(input: MatchInput): MatchResult {
  const skipped = { own: 0, role: 0, kept_apart: 0, group: 0, shared_numbers: 0, large_cards: 0, shared_card_keys: 0, conflicts: 0 };
  const cc = input.countryCode;
  const contactIds = new Set(input.contacts.map((c) => c.id));

  // Who is out of bounds: you, and role addresses.
  const ownKeys = new Set<string>();
  for (const v of input.own) {
    const key = v.includes("@") ? identityKey("email", v, cc) : identityKey("phone", v, cc);
    if (key) ownKeys.add(key);
  }
  const excluded = new Set<string>();
  const byKey = new Map<string, Set<string>>();
  const keysOf = new Map<string, MatchIdentity[]>();
  for (const i of input.identities) {
    if (!contactIds.has(i.contactId)) continue;
    push(keysOf, i.contactId, i);
    const key = identityKey(i.kind, i.value, cc);
    if (key && ownKeys.has(key)) {
      if (!excluded.has(i.contactId)) skipped.own++;
      excluded.add(i.contactId);
    } else if (i.kind === "email" && isRoleAddress(i.value)) {
      if (!excluded.has(i.contactId)) skipped.role++;
      excluded.add(i.contactId);
    }
    if (key) byKey.set(key, (byKey.get(key) ?? new Set()).add(i.contactId));
  }
  const allowed = (id: string) => contactIds.has(id) && !excluded.has(id);
  const hasEmail = (id: string) => (keysOf.get(id) ?? []).some((i) => i.kind === "email");

  const keptApart = new Set(input.dismissed.map(([a, b]) => pairKey(a, b)));
  const inGroup = new Set<string>();
  for (const members of input.groups) {
    const list = [...new Set(members)];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) inGroup.add(pairKey(list[i], list[j]));
  }

  // Certain edges.
  const edges: CertainEdge[] = [];
  const addEdge = (a: string, b: string, reason: CertainReason, evidence: Record<string, string | number>) => {
    if (a !== b && allowed(a) && allowed(b)) edges.push({ a, b, reason, evidence });
  };

  // A number or address on the cards of two or more different people (a shared home or office line) says
  // nothing about who is who. Cards of one person (iCloud and Google both, same name) do not count twice.
  const cardKeys = input.cards.map((card) => [
    ...new Set([
      ...card.emails.map((e) => identityKey("email", e, cc)),
      ...card.phones.map((p) => identityKey("phone", p, cc)),
    ].filter((k): k is string => !!k)),
  ]);
  const peopleOnKey = new Map<string, Set<string>>();
  input.cards.forEach((card, i) => {
    const person = nameKey(card.name) ?? `card:${i}`;
    for (const k of cardKeys[i]) peopleOnKey.set(k, (peopleOnKey.get(k) ?? new Set()).add(person));
  });
  const sharedCardKeys = new Set([...peopleOnKey].filter(([, people]) => people.size > 1).map(([k]) => k));
  skipped.shared_card_keys = sharedCardKeys.size;

  for (const keys of cardKeys) {
    const ids = new Set<string>();
    for (const k of keys) if (!sharedCardKeys.has(k)) for (const id of byKey.get(k) ?? []) ids.add(id);
    const list = [...ids].filter(allowed); // distinct and allowed, so every pair below is an edge
    if (list.length < 2) continue;
    if (list.length > MAX_CARD_CONTACTS) {
      skipped.large_cards++;
      continue;
    }
    for (let i = 1; i < list.length; i++) {
      edges.push({ a: list[0], b: list[i], reason: "address_book", evidence: { card_contacts: list.length }, cardContacts: list });
    }
  }

  for (const [key, ids] of byKey) {
    const list = [...ids];
    for (let i = 1; i < list.length; i++) addEdge(list[0], list[i], "exact_match", { identity: key.startsWith("p:") ? "phone" : "email" });
  }

  const senders = new Map<string, Set<string>>();
  for (const s of input.signaturePhones) {
    const e164 = toE164(s.phone, cc);
    if (e164) senders.set(e164, (senders.get(e164) ?? new Set()).add(s.contactId));
  }
  for (const [phone, from] of senders) {
    if (from.size !== 1) {
      skipped.shared_numbers++;
      continue;
    }
    const [sender] = from;
    if (!hasEmail(sender)) continue;
    for (const owner of byKey.get(`p:${phone}`) ?? []) {
      if (owner !== sender) addEdge(sender, owner, "signature", { signature_contacts: 1 });
    }
  }

  // Join edges into people, strongest first. A join that would put two people kept apart, or two people
  // seen in the same group chat, into one is refused. So is a join that chains two email contacts together
  // through someone else (only one card naming both addresses can do that), or that grows past MAX_CLUSTER.
  edges.sort((x, y) => REASON_ORDER.indexOf(x.reason) - REASON_ORDER.indexOf(y.reason));
  const clusters = new Clusters();
  const accepted: CertainEdge[] = [];
  const refused = new Set<string>();
  for (const edge of edges) {
    if (clusters.find(edge.a) === clusters.find(edge.b)) {
      accepted.push(edge);
      continue;
    }
    let block: "kept_apart" | "group" | "conflicts" | null = null;
    for (const x of clusters.setOf(edge.a)) {
      for (const y of clusters.setOf(edge.b)) {
        const k = pairKey(x, y);
        if (keptApart.has(k)) block = "kept_apart";
        else if (inGroup.has(k)) block ??= "group";
      }
    }
    if (!block) {
      const left = clusters.setOf(edge.a);
      const right = clusters.setOf(edge.b);
      const emailsLeft = [...left].filter(hasEmail);
      const emailsRight = [...right].filter(hasEmail);
      const oneCard = edge.cardContacts && [...emailsLeft, ...emailsRight].every((id) => edge.cardContacts!.includes(id));
      if (left.size + right.size > MAX_CLUSTER || (emailsLeft.length && emailsRight.length && !oneCard)) block = "conflicts";
    }
    if (block) {
      const k = pairKey(edge.a, edge.b);
      if (!refused.has(k)) skipped[block]++;
      refused.add(k);
      continue;
    }
    clusters.union(edge.a, edge.b);
    accepted.push(edge);
  }
  const byRoot = new Map<string, CertainCluster>();
  for (const edge of accepted) {
    const root = clusters.find(edge.a);
    const cluster = byRoot.get(root) ?? { contacts: [...clusters.setOf(root)].sort(), edges: [] };
    cluster.edges.push(edge);
    byRoot.set(root, cluster);
  }
  const certain = [...byRoot.values()];
  const sameCluster = (a: string, b: string) => clusters.find(a) === clusters.find(b);

  // Likely pairs.
  const suggestions = new Map<string, Suggestion>();
  const suggest = (a: string, b: string, reason: SuggestionReason, score: number, evidence: Record<string, string | number>) => {
    if (a === b || !allowed(a) || !allowed(b)) return;
    const k = pairKey(a, b);
    if (keptApart.has(k) || inGroup.has(k) || sameCluster(a, b)) return;
    const current = suggestions.get(k);
    if (current && current.score >= score) return;
    const [contactA, contactB] = ordered(a, b);
    suggestions.set(k, { contactA, contactB, reason, evidence, score });
  };

  const byName = new Map<string, MatchContact[]>();
  const byOrgName = new Map<string, MatchContact[]>();
  const concatForms = new Map<string, Set<string>>();
  const wordsOf = new Map<string, string[]>();
  for (const c of input.contacts) {
    if (!allowed(c.id)) continue;
    const words = nameWords(c.name);
    if (!words.length) continue;
    wordsOf.set(c.id, words);
    const key = [...words].sort().join(" ");
    if (isFullName(words)) {
      push(byName, key, c);
      const first = words[0];
      const last = words[words.length - 1];
      for (const form of [first + last, last + first, key.replace(/ /g, "")]) {
        if (form.length >= 6) concatForms.set(form, (concatForms.get(form) ?? new Set()).add(c.id));
      }
    }
    if (c.organizationId && words.some((w) => w.length >= 2)) {
      const k = `${c.organizationId}|${key}`;
      push(byOrgName, k, c);
    }
  }

  const eachPair = (list: MatchContact[], fn: (a: MatchContact, b: MatchContact) => void) => {
    if (list.length < 2 || list.length > MAX_NAME_GROUP) return;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) fn(list[i], list[j]);
  };

  for (const list of byOrgName.values()) {
    eachPair(list, (a, b) => suggest(a.id, b.id, "same_company_name", 0.85, { organization_id: a.organizationId ?? "", name_words: wordsOf.get(a.id)?.length ?? 0 }));
  }
  for (const list of byName.values()) {
    eachPair(list, (a, b) => {
      const kinds = (id: string) => new Set((keysOf.get(id) ?? []).map((i) => (i.kind === "email" ? "email" : "phone")));
      const ka = kinds(a.id);
      const kb = kinds(b.id);
      const complementary = (ka.has("email") && kb.has("phone") && !ka.has("phone")) || (ka.has("phone") && kb.has("email") && !kb.has("phone"));
      suggest(a.id, b.id, "same_name", complementary ? 0.75 : 0.7, { name_words: wordsOf.get(a.id)?.length ?? 0 });
    });
  }

  for (const i of input.identities) {
    if (i.kind !== "email" || !allowed(i.contactId)) continue;
    const local = i.value.slice(0, i.value.lastIndexOf("@")).toLowerCase().replace(/\+.*$/, "");
    const parts = local.split(/[._-]+/).map((p) => p.replace(/\d+/g, "")).filter(Boolean);
    const matches = new Set<string>();
    if (parts.length >= 2 && parts.every((p) => p.length >= 2)) {
      for (const c of byName.get([...parts].sort().join(" ")) ?? []) matches.add(c.id);
    }
    const letters = parts.join("");
    if (letters.length >= 6) for (const id of concatForms.get(letters) ?? []) matches.add(id);
    matches.delete(i.contactId);
    if (matches.size === 0 || matches.size > 2) continue;
    for (const id of matches) suggest(i.contactId, id, "name_matches_address", 0.6, { identity_id: i.id });
  }

  return { certain, suggestions: [...suggestions.values()].sort((x, y) => y.score - x.score), skipped };
}

/**
 * The contact a cluster is merged into: the one with the most messages, then the one with a real name,
 * then the oldest.
 */
export function chooseKeep(
  ids: string[],
  messageCounts: Map<string, number>,
  contacts: Map<string, { name: string; createdAt: string }>,
): string {
  return [...ids].sort((a, b) => {
    const byCount = (messageCounts.get(b) ?? 0) - (messageCounts.get(a) ?? 0);
    if (byCount) return byCount;
    const byName = Number(isPlaceholderName(contacts.get(a)?.name)) - Number(isPlaceholderName(contacts.get(b)?.name));
    if (byName) return byName;
    const byAge = (contacts.get(a)?.createdAt ?? "").localeCompare(contacts.get(b)?.createdAt ?? "");
    return byAge || a.localeCompare(b);
  })[0];
}

/** The reason recorded when one contact of a cluster is merged into another: its strongest edge. */
export function mergeReason(cluster: CertainCluster, contactId: string): CertainReason {
  const reasons = cluster.edges.filter((e) => e.a === contactId || e.b === contactId).map((e) => e.reason);
  const all = reasons.length ? reasons : cluster.edges.map((e) => e.reason);
  return REASON_ORDER.find((r) => all.includes(r)) ?? "exact_match";
}
