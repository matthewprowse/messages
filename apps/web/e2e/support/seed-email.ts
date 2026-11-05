// Writes the made-up email into Konva Test the way the sync worker stores real mail: every message goes through
// public.ingest_email with the payload apps/worker/src/ingest/store-email.ts builds, so the database makes the contacts,
// identities, companies, threads and messages itself and the browser decrypts them for real. Also builds a single
// message's payload for the fake worker (fake-incoming.ts), which stores later arrivals and sent copies the same way.

import { createHash, randomUUID } from "node:crypto";
import { blindIndex, type UserKeys } from "@messages/crypto";
import { addressIndex, chatIndex, domainIndex } from "@messages/crypto/addresses";
import { companyDomain, companyNameFor, senderName } from "@messages/email-text/company";
import type { Json } from "@messages/db";
import type { Admin } from "./admin";
import { ACCOUNT, PEOPLE, type FakeConversation, type FakePerson } from "./fake-data";
import { FIELD, keysFor, seal } from "./seal";

/** The mailbox owner as a person, so a message from them is outbound. */
export const ME: FakePerson = { name: "Konva Tester", address: ACCOUNT.address };

/** One-line preview, as apps/worker/src/ingest/normalize-email.ts previewOf makes it for text with no quotes or links. */
function previewOf(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 160 ? `${collapsed.slice(0, 159).trimEnd()}…` : collapsed;
}

/** What one message needs to be stored: who, what, when, and where in its conversation. */
export interface Mail {
  id: string;
  /** The Message-ID of the first message of the conversation. */
  root: string;
  replyTo: string | null;
  refs: string[];
  subject: string;
  text: string;
  sentAt: Date;
  from: FakePerson;
  to: FakePerson[];
  outbound: boolean;
  seen: boolean;
  uid: number;
  listUnsubscribe?: string;
}

/** One message's ingest_email payload, field for field as store-email.ts emailPayload builds it for a plain text email. */
export async function emailPayload(userId: string, mail: Mail): Promise<Json> {
  const keys: UserKeys = await keysFor(userId);
  const people = [mail.from, ...mail.to].filter((p) => p.address !== ACCOUNT.address);
  const participants = await Promise.all(people.map(async (p) => {
    const domain = companyDomain(p.address, []);
    const company = domain ? companyNameFor(domain, p.name) : null;
    const name = senderName(p.address, p.name, company, (a) => a);
    return {
      address: await seal(userId, FIELD.address, p.address),
      index: await addressIndex(keys, p.address),
      display_name: await seal(userId, FIELD.name, name),
      name_rank: 2,
      company: domain ? { index: await domainIndex(keys, domain), domain: await seal(userId, FIELD.domain, domain), name: await seal(userId, FIELD.name, company) } : null,
    };
  }));
  const toAddresses = mail.to.map((p) => p.address.toLowerCase());
  return {
    provider_message_id: mail.id,
    thread_root: mail.root,
    in_reply_to: mail.replyTo,
    references: mail.refs,
    subject: await seal(userId, FIELD.subject, mail.subject),
    sent_at: mail.sentAt.toISOString(),
    direction: mail.outbound ? "outbound" : "inbound",
    is_read: mail.outbound || mail.seen,
    thread_root_index: await chatIndex(keys, mail.root),
    sender_address: await seal(userId, FIELD.address, mail.from.address),
    sender_index: await addressIndex(keys, mail.from.address),
    to_addresses: await Promise.all(toAddresses.map((a) => seal(userId, FIELD.address, a))),
    to_indexes: await Promise.all(toAddresses.map((a) => addressIndex(keys, a))),
    preview: await seal(userId, FIELD.preview, previewOf(mail.text)),
    body_text: await seal(userId, FIELD.body, mail.text),
    body_html: null,
    has_original: false,
    is_bulk: false,
    body_marks: null,
    // Where an IMAP message lives, as the IMAP connector records it. There is no server: nothing ever reads it there.
    provider_meta: { folder: mail.outbound ? "Sent" : "INBOX", uid: mail.uid, uid_validity: 1 },
    content_index: await blindIndex(keys, `content:${createHash("sha256").update(`${mail.subject}\n${mail.text}`).digest("hex")}`),
    role: mail.outbound ? "sent" : "inbox",
    participants,
    attachments: [],
    list_unsubscribe: await seal(userId, FIELD.unsubscribe, mail.listUnsubscribe ?? null),
    list_unsubscribe_post: false,
    offers_unsubscribe: !mail.outbound && /unsubscribe/i.test(`${mail.listUnsubscribe ?? ""} ${mail.text}`),
    subject_kept: false,
  };
}

/** What ingest_email says it stored. */
export interface Ingested {
  messageId: string;
  threadId: string;
}

// Konva Test may lack 20261124110000_ingest_email_duplicates.sql, so its ingest_email would still lowercase every
// to_addresses entry, which breaks a sealed one. Production's stores them as given; this puts them back the same way, in
// one read and only for the messages that differ. A no-op once that migration is applied there.
async function keepSealedRecipients(db: Admin, stored: { messageId: string; sealed: string[] }[]) {
  const { data, error } = await db.from("messages").select("id, to_addresses").in("id", stored.map((s) => s.messageId));
  if (error) throw Object.assign(new Error("Could not read the stored messages."), { code: error.code });
  const have = new Map(data.map((r) => [r.id, JSON.stringify(r.to_addresses)]));
  await Promise.all(stored.filter((s) => have.get(s.messageId) !== JSON.stringify(s.sealed)).map(async (s) => {
    const fix = await db.from("messages").update({ to_addresses: s.sealed }).eq("id", s.messageId);
    if (fix.error) throw Object.assign(new Error("Could not fix a stored message's recipients."), { code: fix.error.code });
  }));
}

/** Stores one message through public.ingest_email. Throws with the database's code only (never the message). */
export async function ingestEmail(db: Admin, accountId: string, payload: Json): Promise<Ingested> {
  const { data, error } = await db.rpc("ingest_email", { p_account_id: accountId, p_mail: payload });
  if (error) throw Object.assign(new Error("ingest_email failed."), { code: error.code });
  const done = data as { message_id?: string; thread_id?: string } | null;
  if (!done?.message_id || !done.thread_id) throw new Error("ingest_email stored nothing.");
  await keepSealedRecipients(db, [{ messageId: done.message_id, sealed: (payload as { to_addresses: string[] }).to_addresses }]);
  return { messageId: done.message_id, threadId: done.thread_id };
}

/** A new Message-ID on a reserved domain. */
export const newMessageId = () => `<${randomUUID()}@example.com>`;

/** What the seed made of a conversation: its thread, and its messages in order (each with whether it is the user's own). */
export interface SeededConversation {
  key: string;
  threadId: string;
  root: string;
  messages: { id: string; outbound: boolean }[];
}

// Messages per ingest_email_batch call, as the worker's first sync does (EMAILS_PER_CALL).
const PER_CALL = 25;

/**
 * Ingests every conversation's messages in order, the first one's Message-ID as each thread root, through
 * public.ingest_email_batch: a call per chunk instead of one per message, in order, so a reply never precedes its root.
 */
export async function ingestConversations(db: Admin, userId: string, accountId: string, list: FakeConversation[], now: number): Promise<SeededConversation[]> {
  let uid = 100;
  const flat: { c: FakeConversation; payload: Json; outbound: boolean }[] = [];
  const roots = new Map<string, string>();
  for (const c of list) {
    const ids: string[] = [];
    for (const m of c.messages) {
      const id = newMessageId();
      const outbound = m.from === "me";
      const payload = await emailPayload(userId, {
        id, root: ids[0] ?? id, replyTo: ids.at(-1) ?? null, refs: [...ids], subject: ids.length ? `Re: ${c.subject}` : c.subject, text: m.body,
        sentAt: new Date(now - m.minutesAgo * 60_000), from: outbound ? ME : PEOPLE[m.from as number], to: outbound ? [PEOPLE[c.with]] : [ME],
        outbound, seen: !m.unread, uid: uid++, listUnsubscribe: m.from !== "me" ? c.listUnsubscribe : undefined,
      });
      flat.push({ c, payload, outbound });
      ids.push(id);
    }
    roots.set(c.key, ids[0]);
  }
  const results: { message_id?: string; thread_id?: string; result?: string }[] = [];
  for (let at = 0; at < flat.length; at += PER_CALL) {
    const chunk = flat.slice(at, at + PER_CALL).map((f) => f.payload);
    const { data, error } = await (db.rpc.bind(db) as unknown as (fn: string, args: object) => PromiseLike<{ data: unknown; error: { code?: string } | null }>)("ingest_email_batch", { p_account_id: accountId, p_mails: chunk });
    if (error || !Array.isArray(data) || data.length !== chunk.length) throw Object.assign(new Error("ingest_email_batch failed."), { code: error?.code ?? "bad_result" });
    results.push(...data);
  }
  const bad = results.findIndex((r) => !r.message_id || !r.thread_id);
  if (bad >= 0) throw new Error(`ingest_email_batch stored nothing for message ${bad} (${results[bad]?.result}).`);
  await keepSealedRecipients(db, flat.map((f, i) => ({ messageId: results[i].message_id!, sealed: (f.payload as { to_addresses: string[] }).to_addresses })));
  const made = new Map<string, SeededConversation>();
  flat.forEach((f, i) => {
    const entry = made.get(f.c.key) ?? { key: f.c.key, threadId: results[i].thread_id!, root: roots.get(f.c.key)!, messages: [] };
    entry.messages.push({ id: results[i].message_id!, outbound: f.outbound });
    made.set(f.c.key, entry);
  });
  return list.map((c) => made.get(c.key)!);
}
