import { randomUUID } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer/index.js";

// Pure construction of replies and new emails. No I/O, so it can be unit tested.

export interface ReplyInput {
  from: { name: string | null; address: string };
  to: string[];
  /** Copied in the open: every recipient sees these. */
  cc?: string[];
  /**
   * Copied in secret. Never written to the message unless keepBcc is set, for a provider that reads
   * its recipients from the message itself and strips this header before delivering.
   */
  bcc?: string[];
  subject: string | null;
  /** Message-ID of the message being answered, if any. */
  inReplyTo: string | null;
  /** The conversation's References chain, oldest first. */
  references: string[];
  body: string;
  /** Files to attach, in the order they were added. */
  attachments?: OutgoingAttachment[];
}

/** One file sent with an email. The filename and type are made safe before this point. */
export interface OutgoingAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
  /** WhatsApp only: recorded in the app, so it goes as a voice note once converted. */
  voiceNote?: boolean;
}

function attachmentParts(files: OutgoingAttachment[] | undefined) {
  if (!files?.length) return undefined;
  return files.map((f) => ({ filename: f.filename, contentType: f.contentType, content: f.content, contentDisposition: "attachment" as const }));
}

/** "Re: Subject", without stacking prefixes ("Re: Re: ...") or adding one to a subject that has it. */
export function replySubject(subject: string | null): string {
  const base = (subject ?? "").trim();
  if (!base) return "Re:";
  return /^re\s*:/i.test(base) ? base : `Re: ${base}`;
}

export function newMessageId(fromAddress: string): string {
  const domain = fromAddress.split("@")[1] || "localhost";
  return `<${randomUUID()}@${domain}>`;
}

/** A new email: a reply without the message it answers. */
export type NewEmailInput = Omit<ReplyInput, "inReplyTo" | "references">;

/** Builds the raw MIME message. The same bytes are sent over SMTP and filed in the Sent folder. */
function build(
  input: NewEmailInput,
  messageId: string,
  headers: { subject: string; inReplyTo?: string; references?: string[] },
  keepBcc: boolean,
): Promise<Buffer> {
  const composer = new MailComposer({
    from: input.from.name ? { name: input.from.name, address: input.from.address } : input.from.address,
    to: input.to.map(noBreaks),
    cc: input.cc?.length ? input.cc.map(noBreaks) : undefined,
    bcc: input.bcc?.length ? input.bcc.map(noBreaks) : undefined,
    text: input.body,
    messageId,
    attachments: attachmentParts(input.attachments),
    date: new Date(),
    ...headers,
  });
  const node = composer.compile();
  // MailComposer leaves Bcc out of the headers unless told to keep it, so by default nobody can read it.
  node.keepBcc = keepBcc;
  return node.build();
}

/** An address as one header value: line breaks would let it start a header of its own. */
export function noBreaks(address: string): string {
  return address.replace(/[\r\n]+/g, "");
}

/** A reply: "Re:" on the subject, and In-Reply-To and References so it threads under the message it answers. */
export async function buildReply(input: ReplyInput, messageId: string, keepBcc = false): Promise<Buffer> {
  const references = [...new Set([...input.references, ...(input.inReplyTo ? [input.inReplyTo] : [])])];
  return build(input, messageId, {
    subject: replySubject(input.subject),
    inReplyTo: input.inReplyTo ?? undefined,
    references: references.length ? references : undefined,
  }, keepBcc);
}

/** A new conversation: the subject as typed (one line), and nothing that threads it onto another. */
export async function buildNewEmail(input: NewEmailInput, messageId: string, keepBcc = false): Promise<Buffer> {
  return build(input, messageId, { subject: (input.subject ?? "").replace(/[\r\n]+/g, " ").trim() }, keepBcc);
}
