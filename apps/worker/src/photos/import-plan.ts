import { cardContacts, type Card } from "./cards";

// Which address book cards to import, and as what. Pure, so it can be unit tested; src/photos/import.ts
// does the database work.

export type Identity = { contact_id: string; kind: string; value: string };
export interface ImportRow {
  contact_id: string | null;
  name: string | null;
  emails: string[];
  phones: string[];
}

/**
 * One row per card that is not you and matches at most one contact, and at most one card per existing
 * contact (two cards for one person would fight over its name). toRow gives a card's name, lowercase
 * emails and E.164 phones, or null when it has neither.
 */
export function importRows(
  cards: Card[],
  identities: Identity[],
  toRow: (card: Card) => { name: string | null; emails: string[]; phones: string[] } | null,
  own: Set<string>,
): ImportRow[] {
  const matched = cardContacts(cards, identities);
  const cardsPerContact = new Map<string, number>();
  for (const ids of matched) if (ids.size === 1) for (const id of ids) cardsPerContact.set(id, (cardsPerContact.get(id) ?? 0) + 1);

  const rows: ImportRow[] = [];
  cards.forEach((card, i) => {
    const row = toRow(card);
    if (!row) return;
    if ([...row.emails, ...row.phones].some((v) => own.has(v))) return;
    const ids = matched[i];
    if (ids.size > 1) return;
    const [contactId] = ids;
    if (contactId && cardsPerContact.get(contactId) !== 1) return;
    rows.push({ contact_id: contactId ?? null, name: row.name, emails: row.emails, phones: row.phones.filter((p) => p.startsWith("+")) });
  });
  return rows;
}
