import { FIELD } from "@messages/crypto/fields";
import { isCiphertext } from "@messages/crypto";
import { open, openRows, type TextColumn } from "./vault";

// Encrypted columns and the kind of text each holds. Rows are opened in place as they arrive, before
// data.ts maps them, so a row written before encryption and one written after read the same way.
const THREAD_TEXT: TextColumn[] = [["subject", FIELD.subject], ["last_message_preview", FIELD.preview], ["summary", FIELD.summary]];
const MESSAGE_TEXT: TextColumn[] = [["subject", FIELD.subject], ["preview", FIELD.preview], ["body_text", FIELD.body], ["body_html", FIELD.html], ["list_unsubscribe", FIELD.unsubscribe], ["body_marks", FIELD.marks]];
const DRAFT_TEXT: TextColumn[] = [["body", FIELD.draft], ["instruction", FIELD.instruction], ["decision", FIELD.instruction]];

// Addresses, numbers and chat IDs (encryption stage 2), wherever they sit in a row or the rows nested in
// it: the keys below, and a contact identity's value. A company's domain has its own field.
const ADDRESS_KEYS = new Set(["sender_address", "from_address", "provider_thread_id", "address", "target", "chat", "participant"]);
const ADDRESS_LISTS = new Set(["to_addresses", "send_addresses", "emails", "phones"]);

/** Opens every encrypted address in these rows and anything nested in them, in place. */
export async function openAddresses<T>(rows: T): Promise<T> {
  const work: Promise<void>[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    const row = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(row)) {
      if (isCiphertext(value)) {
        const field = key === "domain" ? FIELD.domain : ADDRESS_KEYS.has(key) || (key === "value" && "kind" in row) ? FIELD.address : null;
        if (field) work.push(open(field, value).then((v) => { row[key] = v ?? ""; }));
      } else if (ADDRESS_LISTS.has(key) && Array.isArray(value)) {
        value.forEach((v, i) => { if (isCiphertext(v)) work.push(open(FIELD.address, v).then((o) => { value[i] = o ?? ""; })); });
      } else if (value && typeof value === "object") {
        walk(value);
      }
    }
  };
  walk(rows);
  await Promise.all(work);
  return rows;
}

export const openThreads = async <T extends object>(rows: T[]) => openAddresses(await openRows(rows, THREAD_TEXT));
export const openDrafts = <T extends object>(rows: T[]) => openRows(rows, DRAFT_TEXT);

/** Opens message rows in place, including the quoted text a WhatsApp reply carries in provider_meta. */
export async function openMessages<T extends object>(rows: T[]): Promise<T[]> {
  await openRows(rows, MESSAGE_TEXT);
  await openAddresses(rows);
  await Promise.all(rows.map(async (r) => {
    const row = r as { provider_meta?: unknown };
    const quoted = (row.provider_meta as { quoted?: { text?: unknown } } | null | undefined)?.quoted;
    if (quoted && isCiphertext(quoted.text)) {
      row.provider_meta = { ...(row.provider_meta as object), quoted: { ...quoted, text: await open(FIELD.quote, quoted.text) } };
    }
    // Reactions are kept by the index of who reacted, with who that is encrypted in reactors: shown by
    // their number or privacy ID again, as before.
    const meta = row.provider_meta as { reactions?: Record<string, string>; reactors?: Record<string, string> } | null | undefined;
    if (meta?.reactions && meta.reactors) {
      const reactions: Record<string, string> = {};
      for (const [who, emoji] of Object.entries(meta.reactions)) reactions[(meta.reactors[who] && (await open(FIELD.address, meta.reactors[who]))) || who] = emoji;
      row.provider_meta = { ...meta, reactions };
    }
  }));
  return rows;
}

/** Opens the conversations nested under contacts (thread_participants -> threads) in place. */
export async function openNestedThreads(contacts: { thread_participants: { threads: object | null }[] }[]): Promise<void> {
  await Promise.all([openThreads(contacts.flatMap((c) => c.thread_participants.flatMap((p) => (p.threads ? [p.threads] : [])))), openAddresses(contacts)]);
}
