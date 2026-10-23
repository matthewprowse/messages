// Address book entries reduced to what matching needs: the saved name, email addresses, phone numbers and
// the photo.
// Pure functions, so they can be unit tested.

import { push } from "../util";

export interface Card {
  /** The name saved in the address book (FN). */
  name: string | null;
  emails: string[];
  phones: string[];
  /** The photo itself, or where to fetch it. */
  photo: { bytes: Buffer } | { url: string } | null;
}

/** Parses one vCard (3.0 or 4.0). Unknown properties are ignored. */
export function parseVCard(text: string): Card {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const card: Card = { name: null, emails: [], phones: [], photo: null };
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const [rawName, ...params] = line.slice(0, colon).split(";");
    const name = rawName.replace(/^[^.]*\./, "").toUpperCase(); // "item1.EMAIL" is EMAIL
    const value = line.slice(colon + 1).trim();
    const param = params.join(";").toUpperCase();
    if (name === "FN" && value) card.name = value.replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " ").trim() || null;
    else if (name === "EMAIL" && value.includes("@")) card.emails.push(value.toLowerCase());
    else if (name === "TEL" && /\d/.test(value)) card.phones.push(value.replace(/^tel:/i, ""));
    else if (name === "PHOTO" && value && !card.photo) {
      if (value.startsWith("data:")) {
        const comma = value.indexOf(",");
        if (comma > 0 && value.slice(0, comma).includes(";base64")) card.photo = { bytes: Buffer.from(value.slice(comma + 1), "base64") };
      } else if (/ENCODING=(B|BASE64)/.test(param)) {
        card.photo = { bytes: Buffer.from(value, "base64") };
      } else if (/^https:\/\//i.test(value)) {
        card.photo = { url: value };
      }
    }
  }
  return card;
}

/** Splits a CardDAV multistatus response into its vCards. */
export function vcardsFromMultistatus(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?address-data[^>]*>([\s\S]*?)<\/(?:\w+:)?address-data>/g)) {
    out.push(unescapeXml(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")));
  }
  return out;
}

export function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/**
 * The last nine digits of a phone number. Address books often hold local numbers ("081 234 5678")
 * while contacts are stored in E.164 ("+27812345678"), and the trailing digits match either way.
 */
export function phoneKey(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-9) : null;
}

/** Every stored contact each card points at, by email address first, then by phone number. Same order as the cards. */
export function cardContacts(cards: Card[], identities: { contact_id: string; kind: string; value: string }[]): Set<string>[] {
  const byEmail = new Map<string, Set<string>>();
  const byPhone = new Map<string, Set<string>>();
  for (const i of identities) {
    // WhatsApp privacy IDs ("...@lid") are not phone numbers, though they are digits.
    const key = i.kind === "email" ? i.value.toLowerCase() : i.value.includes("@") ? null : phoneKey(i.value);
    if (!key) continue;
    const map = i.kind === "email" ? byEmail : byPhone;
    map.set(key, (map.get(key) ?? new Set()).add(i.contact_id));
  }
  return cards.map((card) => {
    const ids = new Set<string>();
    for (const e of card.emails) for (const id of byEmail.get(e) ?? []) ids.add(id);
    if (ids.size === 0) for (const p of card.phones) for (const id of byPhone.get(phoneKey(p) ?? "") ?? []) ids.add(id);
    return ids;
  });
}

/**
 * The one stored contact for each card. A card that matches more than one contact, or a contact that
 * more than one card matches, is skipped rather than guessed.
 */
export function matchCards(
  cards: Card[],
  identities: { contact_id: string; kind: string; value: string }[],
): { contactId: string; card: Card }[] {
  const found = new Map<string, Card[]>();
  cardContacts(cards, identities).forEach((ids, i) => {
    if (ids.size !== 1) return;
    const [id] = ids;
    push(found, id, cards[i]);
  });
  return [...found].filter(([, list]) => list.length === 1).map(([contactId, [card]]) => ({ contactId, card }));
}
