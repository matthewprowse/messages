// The fake worker's other half: mail that arrives (a new message in a conversation, a new conversation, a new WhatsApp
// message) and the copy of a sent reply that the next sync stores. Each is stored exactly as the sync worker stores it,
// through public.ingest_email and public.ingest_whatsapp with the sealed payloads of seed-email.ts and seed-whatsapp.ts,
// so Realtime tells the open app as it would tell it about real mail. Nothing here talks to a provider.

import { randomUUID } from "node:crypto";
import { admin } from "./admin";
import { CONVERSATIONS, PEOPLE } from "./fake-data";
import { CHATS, WA_PEOPLE } from "./fake-chats";
import { ME, emailPayload, ingestEmail, newMessageId } from "./seed-email";
import { ingestWhatsApp, whatsappPayload } from "./seed-whatsapp";
import { FIELD, openText } from "./seal";
import { testUserId, type ProjectName } from "./users";
import { worldOf } from "./world";

let uid = 10_000;

const fail = (what: string, error: { code?: string }) => Object.assign(new Error(`Could not ${what}.`), { code: error.code });

/** The conversation's key in the seed, from its id. Throws when the conversation is not one the seed made. */
function keyOf(project: ProjectName, threadId: string): string {
  const found = Object.entries(worldOf(project).threads).find(([, id]) => id === threadId);
  if (!found) throw new Error("That conversation was not made by the seed.");
  return found[0];
}

/** A new incoming email in a conversation the seed made, as the IMAP connector stores one from the inbox. Returns the new message's id. */
export async function arriveEmail(project: ProjectName, key: string, text: string, from?: number): Promise<string> {
  const world = worldOf(project);
  const c = CONVERSATIONS.find((x) => x.key === key);
  if (!c) throw new Error(`No fake email conversation named ${key}.`);
  const root = world.roots[key];
  const payload = await emailPayload(world.userId, {
    id: newMessageId(), root, replyTo: root, refs: [root], subject: `Re: ${c.subject}`, text, sentAt: new Date(), from: PEOPLE[from ?? c.with], to: [ME],
    outbound: false, seen: false, uid: uid++,
  });
  return (await ingestEmail(admin(), world.accountId, payload)).messageId;
}

/** A new incoming email that starts a conversation of its own. Returns its conversation's id. */
export async function arriveNewEmail(project: ProjectName, subject: string, text: string, from: number): Promise<string> {
  const world = worldOf(project);
  const id = newMessageId();
  const payload = await emailPayload(world.userId, { id, root: id, replyTo: null, refs: [], subject, text, sentAt: new Date(), from: PEOPLE[from], to: [ME], outbound: false, seen: false, uid: uid++ });
  return (await ingestEmail(admin(), world.accountId, payload)).threadId;
}

/** A new incoming WhatsApp message in a chat the seed made, as the connector stores a live one (unread, receipt pending). */
export async function arriveWhatsApp(project: ProjectName, key: string, text: string, from?: number): Promise<string> {
  const world = worldOf(project);
  const c = CHATS.find((x) => x.key === key);
  if (!c) throw new Error(`No fake chat named ${key}.`);
  const sender = WA_PEOPLE[from ?? c.with ?? c.group!.members[0]];
  const payload = await whatsappPayload(world.userId, {
    id: randomUUID().replace(/-/g, "").toUpperCase(), jid: c.jid, group: c.group, sender, other: c.with === undefined ? undefined : WA_PEOPLE[c.with],
    body: text, sentAt: new Date(), fromMe: false, unread: true,
  });
  return (await ingestWhatsApp(admin(), world.whatsappAccountId, payload)).messageId;
}

/**
 * The copy of a sent reply that arrives from the Sent folder on the next sync: the outbox row's text stored as an outbound
 * message in its conversation. The row must be sent already (markOutboxSent), as the copy only exists once the provider
 * has the message. Returns the new message's id.
 */
export async function storeSentCopy(project: ProjectName, outboxId: string): Promise<string> {
  const world = worldOf(project);
  const userId = await testUserId(project);
  const { data: row, error } = await admin().from("outbox").select("status, body, thread_id").eq("user_id", userId).eq("id", outboxId).single();
  if (error) throw fail("read the outbox", error);
  if (row.status !== "sent" || !row.thread_id) throw new Error("The reply is not sent, so there is no copy in the Sent folder yet.");
  const key = keyOf(project, row.thread_id);
  const c = CONVERSATIONS.find((x) => x.key === key);
  if (!c) throw new Error("Only an email conversation has a sent copy.");
  const root = world.roots[key];
  const payload = await emailPayload(userId, {
    id: newMessageId(), root, replyTo: root, refs: [root], subject: `Re: ${c.subject}`, text: (await openText(userId, FIELD.body, row.body)) ?? "", sentAt: new Date(),
    from: ME, to: [PEOPLE[c.with]], outbound: true, seen: true, uid: uid++,
  });
  return (await ingestEmail(admin(), world.accountId, payload)).messageId;
}
