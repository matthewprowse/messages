// The outbox table: the app adds queued replies, the worker claims, sends and settles them.

import type { Tables } from "@messages/db";
import { db, failureCode, must, recordEvent, retryWrite } from "../db";
import { buildNewEmail, buildReply, newMessageId, type OutgoingAttachment, type ReplyInput } from "./compose";
import type { AttachmentProvider } from "./attachment-rules";
import { loadAttachmentFiles, waitForAttachments } from "./outbox-attachments";
import { chooseFrom, fromCandidates, outgoingRecipients, replyToChosen, replyToParticipants, sendableAliases } from "./from-address";
import { identitiesMergedFromElsewhere } from "../contacts/merged-identities";
import { FIELD } from "@messages/crypto/fields";
import { open, openAddresses, openBound } from "../vault";
import { openOutgoingText } from "./outgoing-text";
import { openOutboxAddresses, outboxAt, refusalCode, UNVERIFIED } from "./outbox-open";
import { log } from "../log";
import { mayUseAccount, replyFor, type ReplyFor } from "./inbox";
import { dueFilter, isDue } from "./send-after";
import { flags } from "../flags-db";
import { SENDS_FLAG } from "../flags";

export type OutboxRow = Tables<"outbox">;

/**
 * Marks a queued reply as sending. Returns false if another run already took it, if the app cancelled it (Undo), or if
 * its send_after has not come yet. The due filter is in the same update as the status, so nothing can claim early.
 */
async function claim(id: string): Promise<boolean> {
  const rows = must(
    await db.from("outbox").update({ status: "sending" }).eq("id", id).eq("status", "queued").or(dueFilter()).select("id"),
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
  // The send kill switch (Admin, Flags): the row stays queued, untouched, until the switch is off. Every connector's sends come through here.
  if (await flags.on(SENDS_FLAG, row.user_id)) return null;
  const current = must(await db.from("outbox").select("*").eq("id", row.id).maybeSingle(), "load outbox row");
  if (!current || current.status !== "queued" || !isDue(current.send_after)) return null;
  const problem = await waitForAttachments(current);
  if (!(await claim(current.id))) return null;
  if (problem) {
    await markFailed(current.id, problem);
    return null;
  }
  // The row is claimed now, and nothing has gone to a provider yet. A failure while opening it would leave
  // the row in "sending" for good, so it is failed here instead.
  try {
    // Who it is to and from, opened for sending: the browser stored them encrypted, bound to this row (outbox-open.ts).
    // One that will not open here fails the row: nothing goes to an address moved in from elsewhere, or without a person.
    return await openOutboxAddresses({ ...current, status: "sending" }, openBound);
  } catch (err) {
    await markFailed(current.id, refusedReason(err));
    return null;
  }
}

const NOTHING_SENT = "Nothing was sent. Try again.";

/**
 * A claimed row's body opened strictly for sending (bound to this row's body column, outbox-open.ts), or the reason to fail
 * the row with. For the chat connectors, which send the body alone; email goes through composeOutgoing.
 */
export async function outboxBody(row: Pick<OutboxRow, "id" | "user_id" | "body">): Promise<{ text: string } | { error: string }> {
  try {
    return { text: (await openBound(row.user_id, FIELD.body, row.body, outboxAt(row.id, "body"))) ?? "" };
  } catch (err) {
    return { error: refusedReason(err) };
  }
}

/** Codes that mean the row itself is wrong (not a passing outage): it fails for good with UNVERIFIED. */
const REFUSED = new Set(["plaintext_refused", "legacy_value", "team_value_refused", "sealed_elsewhere", "no_owner", "unreadable"]);

/** The reason to fail a row whose text or addresses would not open: UNVERIFIED for a refusal (logged with its code), else "Try again". */
export function refusedReason(err: unknown): string {
  const code = refusalCode(err);
  // OperationError: WebCrypto's answer to a value altered or sealed under another key, which no retry fixes.
  const refused = REFUSED.has(code) || (err as { name?: string } | null)?.name === "OperationError";
  if (refused) log.warn("outbox row refused", { code });
  return refused ? UNVERIFIED : NOTHING_SENT;
}

/**
 * Safety net for a send that rejected: a row still in "sending" is failed (only while it is, so a row
 * the connector settled is left alone). The wording admits it may have gone out. Never throws.
 */
export async function failStuckSend(id: string) {
  await retryWrite(() =>
    db.from("outbox").update({ status: "failed", error: "Sending was interrupted. Check your Sent folder before trying again." }).eq("id", id).eq("status", "sending"),
  ).catch(() => false);
}

/**
 * Records a send the provider already accepted. Kept apart from the send itself: a failed database
 * write must not mark an email that went out as failed with "Try again", or it is sent twice.
 */
export async function settleSent(id: string, providerMessageId: string): Promise<boolean> {
  reportSend(id, "sent");
  const recorded = await retryWrite(() =>
    db.from("outbox").update({ status: "sent", provider_message_id: providerMessageId, sent_at: new Date().toISOString(), error: null }).eq("id", id),
  );
  if (recorded) return true;
  await markFailed(id, "Sent, but could not be recorded. Check your Sent folder before sending again.", false).catch(() => undefined);
  return false;
}

/** The send's outcome for the usage numbers: which provider and whether it went, never to whom or what. */
function reportSend(id: string, outcome: "sent" | "failed", reason?: string) {
  void Promise.resolve(db.from("outbox").select("user_id, accounts(provider)").eq("id", id).maybeSingle()).then(
    ({ data }) => {
      const provider = data?.accounts?.provider;
      if (data && provider) recordEvent(data.user_id, "send_result", { provider, outcome,...(reason ? { code: failureCode(reason) } : {}) });
    },
    () => undefined,
  );
}

/** Marks a row failed. Retried on a database error and never throws, so a row is not left in "sending". */
export async function markFailed(id: string, reason: string, report = true) {
  if (report) reportSend(id, "failed", reason);
  await retryWrite(() => db.from("outbox").update({ status: "failed", error: reason }).eq("id", id)).catch(() => false);
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

/**
 * Whether this person is on the access list of the shared inbox the conversation is in, and may reply there. Asked only
 * when the reply is not the conversation's own person's. Before the Teams migrations are applied there is no such list.
 */
export async function onInboxList(threadId: string, userId: string): Promise<boolean> {
  const { data, error } = await db.rpc("user_can_reply_in_inbox", { p_thread: threadId, p_user: userId });
  if (error) {
    if (error.code === "PGRST202") return false;
    throw Object.assign(new Error("check shared inbox failed"), { code: error.code });
  }
  return data === true;
}

interface ReplyContext {
  accountId: string;
  threadId: string;
  input: Omit<ReplyInput, "from" | "body">;
  /** To and Cc of the latest inbound message, so the reply goes from the address it was sent to. */
  inboundTo: string[];
  /** Whose reply this is: the conversation's own person's, or a member of the shared inbox it is in. */
  via: ReplyFor;
  /** The person the conversation belongs to, whose key opens its subject. */
  ownerId: string;
}

/**
 * Who a reply goes to and how it threads. It answers the latest message from someone else (Reply, not
 * Reply All). In a conversation with only your own messages, it goes to everyone in the conversation.
 * When the app set To or Cc (Reply All, or a reply with the recipients edited) those replace this, and
 * only the threading is taken from the conversation.
 */
async function replyContext(row: OutboxRow, selfAddresses: Set<string>, explicit: boolean): Promise<ReplyContext | null> {
  if (!row.thread_id) return null; // a new email, not a reply
  // Read together; nothing from the messages is used until the thread is known to be yours.
  const [thread, rawMessages, rawChosen] = await Promise.all([
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
      .then((r) => must(r, "load thread messages")),
    row.reply_to_message_id
      ? db
          .from("messages")
          .select("thread_id, user_id, provider_message_id, reference_ids, subject, sender_address, direction, to_addresses")
          .eq("id", row.reply_to_message_id)
          .maybeSingle()
          .then((r) => must(r, "load chosen message"))
      : null,
  ]);
  if (!thread) return null;
  // A reply is its conversation's own person's, or a member of the shared inbox it is in (checked again here).
  const via = replyFor(thread.user_id, row.user_id, thread.user_id !== row.user_id && (await onInboxList(thread.id, row.user_id)));
  if (via === "nobody") return null;
  // The conversation's own key opens its messages, whoever replies: a member of a shared inbox has no key for them.
  const messages = await openAddresses(thread.user_id, rawMessages);
  const chosen = rawChosen ? await openAddresses(thread.user_id, rawChosen) : null;
  const latest = messages[0];
  const latestInbound = messages.find((m) => m.direction === "inbound" && m.sender_address && !selfAddresses.has(m.sender_address));

  // Reply on a message in the app answers that message instead of the latest one. It must be in this
  // conversation and yours.
  if (row.reply_to_message_id) {
    if (!chosen || chosen.thread_id !== thread.id || chosen.user_id !== thread.user_id) return null;
    const { to, inboundTo } = replyToChosen(chosen, selfAddresses);
    if (to.length === 0 && !explicit) return null;
    return {
      accountId: thread.account_id,
      threadId: thread.id,
      input: { to, subject: chosen.subject ?? thread.subject, inReplyTo: chosen.provider_message_id, references: chosen.reference_ids ?? [] },
      inboundTo,
      via,
      ownerId: thread.user_id,
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
  if (to.length === 0 && !explicit) return null;

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
    via,
    ownerId: thread.user_id,
  };
}

/** The account as it is now. The row a connector started with may predate edits made in the app. */
export async function freshAccount(accountId: string) {
  const account = must(await db.from("accounts").select("id, user_id, provider, address, send_addresses").eq("id", accountId).single(), "load send account");
  return openAddresses(account.user_id, account);
}

export type SendAccount = Awaited<ReturnType<typeof freshAccount>>;

/**
 * The From address for a queued email: the one chosen in the app if this account can send from it,
 * else the default. Returns the reason to fail the row with when the chosen one is not allowed.
 */
function resolveFrom(row: OutboxRow, account: SendAccount, inboundTo: string[], via: ReplyFor): { address: string } | { error: string } {
  if (!mayUseAccount(account.user_id, row.user_id, via)) return { error: OTHER_ACCOUNT };
  // Only aliases the provider vouches for: the list is typed in the app for some providers (from-address.ts).
  return chooseFrom({ requested: row.from_address, accountAddress: account.address, sendAddresses: sendableAliases(account.provider, account.send_addresses), inboundTo });
}

const OTHER_ACCOUNT = "This email belongs to another account.";

interface NewEmailContext {
  subject: string | null;
}

/** A new email (no conversation yet) for this account, or the reason it cannot be sent. */
function newEmailContext(row: OutboxRow, accountId: string): NewEmailContext | { error: string } {
  if (row.thread_id || row.account_id !== accountId) return { error: OTHER_ACCOUNT };
  return { subject: row.subject?.trim() || null };
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
  cc: string[];
  bcc: string[];
  /** The conversation a reply belongs to. Null for a new email until its sent copy is stored. */
  threadId: string | null;
  /** How many files are attached. */
  attachmentCount: number;
  /** The files themselves. Inside raw too, unless they were asked for apart. */
  files: OutgoingAttachment[];
}

/**
 * Builds a queued reply or new email for this account, or gives the reason to fail it with. A caller
 * that has just loaded the account passes it in, so it is not read twice. With filesApart the email is
 * built without its files, for a provider that takes them separately (Outlook's upload sessions). With
 * keepBcc the message carries its Bcc header, for a provider that reads its recipients from the message
 * and removes that header before delivering (Gmail, Microsoft Graph). Otherwise Bcc is never in the bytes,
 * and the caller must send to `bcc` as well (SMTP envelope).
 */
export async function composeOutgoing(
  row: OutboxRow,
  accountId: string,
  selfAddresses: Set<string>,
  provider: AttachmentProvider,
  account?: SendAccount,
  filesApart = false,
  keepBcc = false,
): Promise<Outgoing | { error: string }> {
  // What you wrote may be stored encrypted.
  // Strictly: a body that cannot be decrypted, or was sealed for another row, must fail the send, never go out blank.
  let refusal: unknown = null;
  const strictly = (field: typeof FIELD.body | typeof FIELD.subject, column: string) => (v: string | null) =>
    openBound(row.user_id, field, v, outboxAt(row.id, column)).catch((err) => { refusal = err; throw err; });
  const opened = await openOutgoingText(row, strictly(FIELD.body, "body"), strictly(FIELD.subject, "subject"));
  if (!opened) return { error: refusedReason(refusal) };
  row = opened;
  // The recipients are checked first: that needs nothing from the database.
  const recipients = outgoingRecipients(row, !!row.thread_id);
  if ("error" in recipients) return recipients;
  const fresh = row.thread_id ? null : newEmailContext(row, accountId);
  if (fresh && "error" in fresh) return fresh;

  // The rest is read at once: the conversation a reply answers, the account, your name and the files.
  const [reply, sendAccount, name, attachments] = await Promise.all([
    fresh ? null : replyContext(row, selfAddresses, recipients.explicit),
    account ?? freshAccount(accountId),
    senderName(row.user_id),
    loadAttachmentFiles(row, provider),
  ]);
  if (!fresh && (!reply || reply.accountId !== accountId)) return { error: "There is no one to reply to in this conversation." };
  if (reply) reply.input.subject = await open(reply.ownerId, FIELD.subject, reply.input.subject);

  const chosen = resolveFrom(row, sendAccount, reply?.inboundTo ?? [], reply?.via ?? "owner");
  if ("error" in chosen) return chosen;
  if ("error" in attachments) return attachments;
  const from = { name, address: chosen.address };
  const messageId = newMessageId(from.address);
  // A reply with To or Cc set in the app goes to exactly those; otherwise the worker's own pick.
  const to = reply && !recipients.explicit ? reply.input.to : recipients.to;
  const { cc, bcc } = recipients;
  const inside = filesApart ? [] : attachments;
  const raw = reply
    ? await buildReply({ ...reply.input, to, cc, bcc, from, body: row.body, attachments: inside }, messageId, keepBcc)
    : await buildNewEmail({ from, to, cc, bcc, subject: fresh!.subject, body: row.body, attachments: inside }, messageId, keepBcc);
  return { raw, messageId, from: from.address, to, cc, bcc, threadId: reply?.threadId ?? null, attachmentCount: attachments.length, files: attachments };
}
