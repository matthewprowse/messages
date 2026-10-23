import type { Tables } from "@messages/db";
import { db, must, retryWrite } from "../db";
import { buildNewEmail, buildReply, newMessageId, type ReplyInput } from "./compose";
import type { AttachmentProvider } from "./attachment-rules";
import { loadAttachmentFiles, waitForAttachments } from "./outbox-attachments";
import { BAD_RECIPIENTS, chooseFrom, cleanRecipients, fromCandidates, replyToChosen, replyToParticipants } from "./from-address";
import { identitiesMergedFromElsewhere } from "../contacts/merged-identities";
import { FIELD } from "@messages/crypto/fields";
import { open, openAddresses } from "../vault";

// The outbox table: the app adds queued replies, the worker claims, sends and settles them.

export type OutboxRow = Tables<"outbox">;

/** Marks a queued reply as sending. Returns false if another run already took it. */
async function claim(id: string): Promise<boolean> {
  const rows = must(
    await db.from("outbox").update({ status: "sending" }).eq("id", id).eq("status", "queued").select("id"),
    "claim outbox row",
  );
  return rows.length === 1;
}

/**
 * Claims a queued email once the app has added all its files, and returns the row as it is now. The
 * app can add files only while the row is queued, so the wait comes before the claim. A row whose
 * files never arrive is claimed and failed. Returns null when there is nothing to send.
 */
export async function claimReady(row: OutboxRow): Promise<OutboxRow | null> {
  const current = must(await db.from("outbox").select("*").eq("id", row.id).maybeSingle(), "load outbox row");
  if (!current || current.status !== "queued") return null;
  const problem = await waitForAttachments(current);
  if (!(await claim(current.id))) return null;
  if (problem) {
    await markFailed(current.id, problem);
    return null;
  }
  // Who it is to and from, opened for sending: the browser stored them encrypted.
  return openAddresses(current.user_id, { ...current, status: "sending" });
}

/**
 * Records a send the provider already accepted. Kept apart from the send itself: a failed database
 * write must not mark an email that went out as failed with "Try again", or it is sent twice.
 */
export async function settleSent(id: string, providerMessageId: string): Promise<boolean> {
  const recorded = await retryWrite(() =>
    db.from("outbox").update({ status: "sent", provider_message_id: providerMessageId, sent_at: new Date().toISOString(), error: null }).eq("id", id),
  );
  if (recorded) return true;
  await markFailed(id, "Sent, but could not be recorded. Check your Sent folder before sending again.").catch(() => undefined);
  return false;
}

export async function markFailed(id: string, reason: string) {
  must(await db.from("outbox").update({ status: "failed", error: reason }).eq("id", id), "mark outbox failed");
}

/**
 * A reply left in "sending" by a worker that stopped mid-send may or may not have gone out.
 * It is failed rather than retried, so nobody gets the same email twice.
 */
export async function failInterrupted() {
  must(
    await db
      .from("outbox")
      .update({ status: "failed", error: "Sending was interrupted. Check your Sent folder before trying again." })
      .eq("status", "sending"),
    "fail interrupted sends",
  );
}

interface ReplyContext {
  accountId: string;
  threadId: string;
  input: Omit<ReplyInput, "from" | "body">;
  /** To and Cc of the latest inbound message, so the reply goes from the address it was sent to. */
  inboundTo: string[];
}

/**
 * Who a reply goes to and how it threads. It answers the latest message from someone else (Reply, not
 * Reply All). In a conversation with only your own messages, it goes to everyone in the conversation.
 */
async function replyContext(row: OutboxRow, selfAddresses: Set<string>): Promise<ReplyContext | null> {
  if (!row.thread_id) return null; // a new email, not a reply
  // Read together; nothing from the messages is used until the thread is known to be yours.
  const [thread, messages, chosen] = await Promise.all([
    db
      .from("threads")
      .select("id, account_id, subject, user_id")
      .eq("id", row.thread_id)
      .maybeSingle()
      .then((r) => must(r, "load thread")),
    db
      .from("messages")
      .select("provider_message_id, reference_ids, subject, sender_address, direction, to_addresses")
      .eq("thread_id", row.thread_id)
      .order("sent_at", { ascending: false })
      .limit(50)
      .then((r) => openAddresses(row.user_id, must(r, "load thread messages"))),
    row.reply_to_message_id
      ? db
          .from("messages")
          .select("thread_id, user_id, provider_message_id, reference_ids, subject, sender_address, direction, to_addresses")
          .eq("id", row.reply_to_message_id)
          .maybeSingle()
          .then((r) => openAddresses(row.user_id, must(r, "load chosen message")))
      : null,
  ]);
  if (!thread || thread.user_id !== row.user_id) return null;
  const latest = messages[0];
  const latestInbound = messages.find((m) => m.direction === "inbound" && m.sender_address && !selfAddresses.has(m.sender_address));

  // Reply on a message in the app answers that message instead of the latest one. It must be in this
  // conversation and yours.
  if (row.reply_to_message_id) {
    if (!chosen || chosen.thread_id !== thread.id || chosen.user_id !== row.user_id) return null;
    const { to, inboundTo } = replyToChosen(chosen, selfAddresses);
    if (to.length === 0) return null;
    return {
      accountId: thread.account_id,
      threadId: thread.id,
      input: { to, subject: chosen.subject ?? thread.subject, inReplyTo: chosen.provider_message_id, references: chosen.reference_ids ?? [] },
      inboundTo,
    };
  }

  let to: string[];
  if (latestInbound?.sender_address) {
    to = [latestInbound.sender_address];
  } else {
    const people = must(
      await db
        .from("thread_participants")
        .select("contact_id, contacts(contact_identities(id, kind, value))")
        .eq("thread_id", thread.id),
      "load participants",
    );
    await openAddresses(row.user_id, people);
    const mergedIn = await identitiesMergedFromElsewhere(thread.id, people.map((p) => p.contact_id));
    const emails = people.flatMap((p) => p.contacts?.contact_identities.filter((i) => i.kind === "email" && !mergedIn.has(i.id)).map((i) => i.value) ?? []);
    to = replyToParticipants(emails, latest?.sender_address ?? null, selfAddresses);
  }
  if (to.length === 0) return null;

  const answering = latestInbound ?? latest;
  return {
    accountId: thread.account_id,
    threadId: thread.id,
    input: {
      to,
      subject: answering?.subject ?? thread.subject,
      inReplyTo: answering?.provider_message_id ?? null,
      references: answering?.reference_ids ?? [],
    },
    inboundTo: fromCandidates(messages),
  };
}

/** The account as it is now. The row a connector started with may predate edits made in the app. */
export async function freshAccount(accountId: string) {
  const account = must(await db.from("accounts").select("id, user_id, address, send_addresses").eq("id", accountId).single(), "load send account");
  return openAddresses(account.user_id, account);
}

export type SendAccount = Awaited<ReturnType<typeof freshAccount>>;

/**
 * The From address for a queued email: the one chosen in the app if this account can send from it,
 * else the default. Returns the reason to fail the row with when the chosen one is not allowed.
 */
function resolveFrom(row: OutboxRow, account: SendAccount, inboundTo: string[]): { address: string } | { error: string } {
  if (account.user_id !== row.user_id) return { error: OTHER_ACCOUNT };
  return chooseFrom({ requested: row.from_address, accountAddress: account.address, sendAddresses: account.send_addresses, inboundTo });
}

const OTHER_ACCOUNT = "This email belongs to another account.";

interface NewEmailContext {
  to: string[];
  subject: string | null;
}

/** A new email (no conversation yet) for this account, or the reason it cannot be sent. */
function newEmailContext(row: OutboxRow, accountId: string): NewEmailContext | { error: string } {
  if (row.thread_id || row.account_id !== accountId) return { error: OTHER_ACCOUNT };
  const to = cleanRecipients(row.to_addresses);
  if (!to) return { error: BAD_RECIPIENTS };
  return { to, subject: row.subject?.trim() || null };
}

const LINK_WINDOW_MS = 7 * 24 * 60 * 60_000;

/**
 * Points sent new emails at the conversation their sent copy was stored in, so the app can open it.
 * Matched by Message-ID; rows whose copy is not stored yet are tried again on the next pass, for a
 * week, newest first, so an email whose copy never arrives cannot crowd out the rest.
 */
export async function linkNewEmails(accountId: string): Promise<number> {
  const rows = must(
    await db
      .from("outbox")
      .select("id, provider_message_id")
      .eq("account_id", accountId)
      .eq("status", "sent")
      .is("thread_id", null)
      .not("provider_message_id", "is", null)
      .gte("sent_at", new Date(Date.now() - LINK_WINDOW_MS).toISOString())
      .order("sent_at", { ascending: false })
      .limit(50),
    "load unlinked new emails",
  );
  if (rows.length === 0) return 0;
  const messages = must(
    await db
      .from("messages")
      .select("thread_id, provider_message_id")
      .eq("account_id", accountId)
      .in("provider_message_id", rows.map((r) => r.provider_message_id!)),
    "find sent copies",
  );
  const threadOf = new Map<string, string>();
  for (const m of messages) if (m.provider_message_id && !threadOf.has(m.provider_message_id)) threadOf.set(m.provider_message_id, m.thread_id);
  let linked = 0;
  for (const row of rows) {
    const threadId = threadOf.get(row.provider_message_id!);
    if (!threadId) continue;
    await linkThread(row.id, threadId);
    linked++;
  }
  return linked;
}

/**
 * Links a sent new email to its conversation and lists that conversation in the Inbox. A conversation
 * that starts with your own message is stored as archived, which would hide the email just sent.
 */
export async function linkThread(outboxId: string, threadId: string) {
  const linked = must(
    await db.from("outbox").update({ thread_id: threadId }).eq("id", outboxId).is("thread_id", null).select("id"),
    "link new email",
  );
  if (linked.length === 0) return; // linked before; leave the conversation where you put it
  must(await db.from("threads").update({ status: "inbox" }).eq("id", threadId).eq("status", "archived"), "list new conversation");
}

/** Conversations among these that were started from the app and have no reply yet. */
export async function startedHere(accountId: string, threadIds: string[]): Promise<Set<string>> {
  if (threadIds.length === 0) return new Set();
  const rows = must(
    await db.from("outbox").select("thread_id").eq("account_id", accountId).eq("status", "sent").in("thread_id", threadIds),
    "load new email threads",
  );
  const started = [...new Set(rows.map((r) => r.thread_id!).filter(Boolean))];
  if (started.length === 0) return new Set();
  const answered = new Set(
    must(
      await db.from("messages").select("thread_id").in("thread_id", started).eq("direction", "inbound"),
      "check new email replies",
    ).map((r) => r.thread_id),
  );
  return new Set(started.filter((id) => !answered.has(id)));
}

async function senderName(userId: string): Promise<string | null> {
  const profile = must(await db.from("profiles").select("display_name").eq("user_id", userId).maybeSingle(), "load profile");
  return profile?.display_name?.trim() || null;
}

/** One email ready to go: the exact bytes, who it goes to and from, and the conversation it answers. */
interface Outgoing {
  raw: Buffer;
  messageId: string;
  from: string;
  to: string[];
  /** The conversation a reply belongs to. Null for a new email until its sent copy is stored. */
  threadId: string | null;
  /** How many files are attached. */
  attachmentCount: number;
}

/**
 * Builds a queued reply or new email for this account, or gives the reason to fail it with. A caller
 * that has just loaded the account passes it in, so it is not read twice.
 */
export async function composeOutgoing(
  row: OutboxRow,
  accountId: string,
  selfAddresses: Set<string>,
  provider: AttachmentProvider,
  account?: SendAccount,
): Promise<Outgoing | { error: string }> {
  // What you wrote may be stored encrypted.
  row = { ...row, body: (await open(row.user_id, FIELD.body, row.body)) ?? "", subject: await open(row.user_id, FIELD.subject, row.subject) };
  // A new email's recipients are checked first: that needs nothing from the database.
  const fresh = row.thread_id ? null : newEmailContext(row, accountId);
  if (fresh && "error" in fresh) return fresh;

  // The rest is read at once: the conversation a reply answers, the account, your name and the files.
  const [reply, sendAccount, name, attachments] = await Promise.all([
    fresh ? null : replyContext(row, selfAddresses),
    account ?? freshAccount(accountId),
    senderName(row.user_id),
    loadAttachmentFiles(row, provider),
  ]);
  if (!fresh && (!reply || reply.accountId !== accountId)) return { error: "There is no one to reply to in this conversation." };
  if (reply) reply.input.subject = await open(row.user_id, FIELD.subject, reply.input.subject);

  const chosen = resolveFrom(row, sendAccount, reply?.inboundTo ?? []);
  if ("error" in chosen) return chosen;
  if ("error" in attachments) return attachments;
  const from = { name, address: chosen.address };
  const messageId = newMessageId(from.address);
  const to = reply ? reply.input.to : fresh!.to;
  const raw = reply
    ? await buildReply({ ...reply.input, from, body: row.body, attachments }, messageId)
    : await buildNewEmail({ from, to, subject: fresh!.subject, body: row.body, attachments }, messageId);
  return { raw, messageId, from: from.address, to, threadId: reply?.threadId ?? null, attachmentCount: attachments.length };
}
