import type { Json } from "@messages/db";
import { db, must, type AccountRow } from "../db";
import { BatchRpc, isFailure, type RowFailure, type RpcResponse } from "./batch-rpc";
import { nameFromAddress, type NormalizedEmail } from "./normalize-email";
import { FIELD } from "@messages/crypto/fields";
import { addressIndex, chatIndex, domainIndex } from "@messages/crypto/addresses";
import { keysFor, seal, sealAddress, sealDomain } from "../vault";
import { bodySource, emphasisRuns, isBulkMail } from "@messages/email-text";
import { companyDomain, companyNameFor, senderName } from "@messages/email-text/company";
import { ownIdentitiesCached } from "../contacts/own";

/** Emails per bulk call: bodies can be large, so fewer than for WhatsApp. */
const EMAILS_PER_CALL = 25;

export type FolderRole = "inbox" | "sent" | "archive";

export interface EmailContext {
  role: FolderRole;
  /** Where the message lives on the server, e.g. IMAP folder and UID, or Gmail ID and labels. */
  meta: Record<string, Json>;
  seen: boolean;
  /** Every address that is "you" on this account: the custom domain, the iCloud login and any aliases. */
  selfAddresses: Set<string>;
}

export interface StoredEmail {
  result: "inserted" | "updated";
  messageId: string | null;
  threadId: string | null;
}

/** What public.ingest_email returns for one message. */
type IngestResult = { result: "inserted" | "updated"; message_id?: string; thread_id?: string };

const stored = (r: IngestResult): StoredEmail => ({ result: r.result, messageId: r.message_id ?? null, threadId: r.thread_id ?? null });

async function ingestOne(accountId: string, payload: Json): Promise<IngestResult> {
  return must(await db.rpc("ingest_email", { p_account_id: accountId, p_mail: payload }), "ingest email") as IngestResult;
}

const ingestMany = new BatchRpc<Json, IngestResult>(
  "ingest_email_batch",
  EMAILS_PER_CALL,
  // Not in the generated database types until the migration is applied and they are regenerated.
  (accountId, mails) => (db.rpc.bind(db) as unknown as (fn: string, args: object) => PromiseLike<RpcResponse>)("ingest_email_batch", { p_account_id: accountId, p_mails: mails }),
  ingestOne,
);

/**
 * Stores one email exactly once, in a single database call (public.ingest_email). A message seen again
 * (a re-sync, or the same email found in another folder) only refreshes where it lives and its read state.
 */
export async function storeEmail(account: AccountRow, mail: NormalizedEmail, ctx: EmailContext): Promise<StoredEmail> {
  return stored(await ingestOne(account.id, await emailPayload(account, mail, ctx)));
}

/**
 * Stores many emails, in order, a chunk per database call (public.ingest_email_batch), for first syncs
 * and backfills. Results come back in the same order. An email that could not be stored comes back as a
 * RowFailure and the others are stored regardless.
 */
export async function storeEmails(account: AccountRow, items: { mail: NormalizedEmail; ctx: EmailContext }[]): Promise<(StoredEmail | RowFailure)[]> {
  const results = await ingestMany.run(account.id, await Promise.all(items.map((i) => emailPayload(account, i.mail, i.ctx))));
  return results.map((r) => (isFailure(r) ? r : stored(r)));
}

// A subject that reads like a receipt, invoice or ticket keeps a PDF visible in a junk conversation. The
// same words as public.attachment_looks_kept, which now reads this as messages.subject_kept.
const KEEPS_FILES = /(receipt|invoice|ticket|statement|booking|itinerary|confirmation|reservation|boarding|voucher|order|tax|bill|payslip|payment|purchase|quotation|quote|rechnung|factura|factuur|recibo)/i;

/** The styled runs of an email's HTML as JSON for messages.body_marks, or null when nothing is styled. */
export function marksJson(html: string | null): string | null {
  const runs = html ? emphasisRuns(html) : [];
  return runs.length ? JSON.stringify(runs) : null;
}

/**
 * The JSON public.ingest_email takes for one email. Its text is sealed (encrypted when ENCRYPT_CONTENT is
 * on), so the two things the database used to work out from that text are worked out here first.
 */
async function emailPayload(account: AccountRow, mail: NormalizedEmail, ctx: EmailContext): Promise<Json> {
  const outbound = ctx.role === "sent" || (mail.from !== null && ctx.selfAddresses.has(mail.from.address));
  const user = account.user_id;

  // Everyone involved except you, sender first so incoming mail is linked to who sent it.
  const people = [mail.from, ...mail.to, ...mail.cc].filter(
    (a): a is NonNullable<typeof a> => a !== null && !ctx.selfAddresses.has(a.address),
  );
  // Each with the blind index the database matches them on, and the company their domain belongs to.
  const keys = await keysFor(user);
  const own = await ownIdentitiesCached(user);
  const participants = await Promise.all(
    [...new Map(people.map((p) => [p.address, p])).values()].map(async (p) => {
      const domain = companyDomain(p.address, own);
      const company = domain ? companyNameFor(domain, p.name) : null;
      return {
        address: await sealAddress(user, p.address),
        index: await addressIndex(keys, p.address),
        // An automated sender with no real name (noreply@, "No Reply") is named for its company.
        display_name: senderName(p.address, p.name, company, nameFromAddress),
        company: domain ? { index: await domainIndex(keys, domain), domain: await sealDomain(user, domain), name: company } : null,
      };
    }),
  );
  const toAddresses = [...new Set([...mail.to, ...mail.cc].map((a) => a.address.toLowerCase()))];

  const payload = {
    provider_message_id: mail.providerMessageId,
    thread_root: mail.threadRoot,
    in_reply_to: mail.inReplyTo,
    references: mail.references,
    subject: await seal(user, FIELD.subject, mail.subject),
    sent_at: mail.sentAt.toISOString(),
    direction: outbound ? "outbound" : "inbound",
    is_read: outbound || ctx.seen,
    thread_root_index: await chatIndex(keys, mail.threadRoot),
    sender_address: await sealAddress(user, mail.from?.address ?? null),
    sender_index: mail.from ? await addressIndex(keys, mail.from.address) : null,
    // Who it was sent to, so a reply can default to going from that address.
    to_addresses: await Promise.all(toAddresses.map((a) => sealAddress(user, a))),
    to_indexes: await Promise.all(toAddresses.map((a) => addressIndex(keys, a))),
    preview: await seal(user, FIELD.preview, mail.preview),
    // The HTML is not stored: View Original fetches it from the provider. When the text part is missing
    // or junk, readable text taken from the HTML is stored in its place.
    body_text: await seal(user, FIELD.body, mail.html ? bodySource(mail.text, mail.html) : mail.text),
    body_html: null,
    has_original: mail.html !== null,
    is_bulk: isBulkMail(mail.html),
    // The bold and italic runs of the HTML, so the bubble can still draw them once the HTML is gone.
    body_marks: await seal(user, FIELD.marks, marksJson(mail.html)),
    provider_meta: ctx.meta,
    role: ctx.role,
    participants,
    attachments: await Promise.all(mail.attachments.map(async (a) => ({ filename: (await seal(user, FIELD.filename, a.filename))!, mime_type: a.mimeType, kind: a.kind, size_bytes: a.sizeBytes }))),
    // The sender's unsubscribe instructions, stored with a new message in the same call.
    list_unsubscribe: await seal(user, FIELD.unsubscribe, mail.listUnsubscribe),
    list_unsubscribe_post: mail.listUnsubscribePost,
    // An incoming email that offers a way out marks its conversation a subscription.
    offers_unsubscribe: !outbound && /unsubscribe/i.test(`${mail.html ?? ""} ${mail.text ?? ""}`),
    subject_kept: KEEPS_FILES.test(mail.subject ?? ""),
  } satisfies Record<string, Json>;
  return payload;
}

/**
 * Applies a read or unread change made elsewhere (your phone, iCloud.com) to the stored message,
 * found by its folder and IMAP UID. A message already in that state is left alone, and so is its thread.
 */
export async function applyReadState(account: AccountRow, folder: string, uid: number, seen: boolean) {
  const updated = must(
    await db
      .from("messages")
      .update({ is_read: seen })
      .eq("account_id", account.id)
      .eq("direction", "inbound")
      .eq("provider_meta->>folder", folder)
      .eq("provider_meta->>uid", String(uid))
      .neq("is_read", seen)
      .select("thread_id"),
    "apply read state",
  );
  for (const threadId of new Set(updated.map((m) => m.thread_id))) {
    must(await db.rpc("refresh_thread", { p_thread_id: threadId }), "refresh thread");
  }
}
