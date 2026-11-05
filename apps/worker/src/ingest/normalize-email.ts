// Pure conversion of a parsed MIME message into the shape we store. No I/O, so it can be unit tested.

import { createHash } from "node:crypto";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { hiddenReasonOf, type HiddenReason } from "./attachment-hidden";
import { nameMismatch, parseAuthResults, type AuthservTrust, type EmailAuth } from "./email-auth";

export interface EmailAddress {
  address: string; // lowercase
  name: string | null;
}

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  kind: "image" | "pdf" | "video" | "audio" | "file";
  sizeBytes: number;
  /** The file itself. Uploaded to storage, never sent to the database row. */
  content: Buffer;
  /** Set for logos, signature images and tracking pixels, which stay out of the attachment lists. */
  hiddenReason?: HiddenReason | null;
}

export interface NormalizedEmail {
  providerMessageId: string;
  /** Root of the conversation: first References entry, else In-Reply-To, else this message. */
  threadRoot: string;
  inReplyTo: string | null;
  references: string[];
  subject: string | null;
  sentAt: Date;
  from: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  text: string | null;
  html: string | null;
  /** One line for the conversation list: the new text, or the subject when there is no readable text. */
  preview: string | null;
  attachments: EmailAttachment[];
  /** The raw List-Unsubscribe value: <https://...>, <mailto:...> entries. */
  listUnsubscribe: string | null;
  /** True when the sender supports one-click unsubscribe (RFC 8058). */
  listUnsubscribePost: boolean;
  /** The receiving server's SPF, DKIM and DMARC verdicts, or null when it gave none (or named a server that is not the provider). */
  auth: EmailAuth | null;
  /** The From display name named an address or domain of another brand than the From address (email-auth.ts). */
  nameMismatch: boolean;
  /**
   * The domain of a Reply-To address at another domain than the From address, lowercase, else null. Only the domain:
   * the AI worker's phishing check compares it with the sender's, and the address itself never needs to be stored.
   */
  replyToDomain: string | null;
  /**
   * A hash of what the email says (Date, From, subject, text, HTML and files), the same in every folder it is found in.
   * Two emails with one Message-ID but different hashes are different emails. Never stored as it is: store-email.ts keys it.
   */
  contentHash: string;
}

function addresses(field: AddressObject | AddressObject[] | undefined): EmailAddress[] {
  const groups = Array.isArray(field) ? field : field ? [field] : [];
  const out: EmailAddress[] = [];
  for (const group of groups) {
    for (const entry of group.value) {
      // Group syntax ("Team: a@x, b@y;") nests addresses one level down.
      const members = entry.group ?? [entry];
      for (const m of members) {
        if (m.address) out.push({ address: m.address.trim().toLowerCase(), name: plainLetters(m.name?.trim() || "") || null });
      }
    }
  }
  return out;
}

function kindOf(mimeType: string): EmailAttachment["kind"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

/**
 * @param fallbackId used when a message has no Message-ID header (rare, but it happens),
 *                   so it still gets a stable identity for de-duplication.
 */
/**
 * @param trustAuth which Authentication-Results servers count (email-auth.ts authservTrust); without it the topmost
 * header is taken as the provider's, as callers that only read a message's files or HTML do.
 */
export function normalizeEmail(parsed: ParsedMail, fallbackId: string, trustAuth?: AuthservTrust): NormalizedEmail {
  const providerMessageId = parsed.messageId?.trim() || fallbackId;
  const references = (Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [])
    .map((r) => r.trim())
    .filter(Boolean);
  const inReplyTo = parsed.inReplyTo?.trim() || null;

  const text = plainLetters(parsed.text?.trim() || "") || null;
  const subject = plainLetters(parsed.subject?.trim() || "") || null;

  return {
    providerMessageId,
    threadRoot: references[0] ?? inReplyTo ?? providerMessageId,
    inReplyTo,
    references,
    subject,
    sentAt: parsed.date ?? new Date(),
    from: addresses(parsed.from)[0] ?? null,
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    text,
    html: typeof parsed.html === "string" ? parsed.html : null,
    preview: previewOf(text) ?? subject,
    listUnsubscribe: headerValue(parsed, "list-unsubscribe"),
    listUnsubscribePost: /List-Unsubscribe=One-Click/i.test(headerValue(parsed, "list-unsubscribe-post") ?? ""),
    auth: parseAuthResults(headerValues(parsed, "authentication-results"), trustAuth),
    nameMismatch: nameMismatch(addresses(parsed.from)[0]?.name, addresses(parsed.from)[0]?.address),
    replyToDomain: replyToDomainOf(addresses(parsed.from)[0] ?? null, addresses(parsed.replyTo)),
    contentHash: contentHashOf(parsed, text, subject),
    // Inline parts referenced from the HTML (logos, signature images) are not real attachments.
    attachments: parsed.attachments
      .filter((a) => !a.related)
      .map((a) => ({
        filename: a.filename ?? "attachment",
        mimeType: a.contentType,
        kind: kindOf(a.contentType),
        sizeBytes: a.size,
        content: a.content,
        hiddenReason: hiddenReasonOf(
          { filename: a.filename ?? "", mimeType: a.contentType, sizeBytes: a.size, content: a.content, contentId: a.cid, disposition: a.contentDisposition },
          typeof parsed.html === "string" ? parsed.html : null,
        ),
      })),
  };
}

// Senders sometimes "style" text with Unicode look-alike letters (mathematical bold or italic, script,
// full-width), which shows as a different font. These map back to ordinary letters and digits.
const STYLED_LETTERS =
  /[\u{1D400}-\u{1D7FF}\u2102\u210A-\u2113\u2115\u2119-\u211D\u2124\u2128\u212C\u212D\u212F-\u2131\u2133\u2134\u2139\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/gu;

export function plainLetters(value: string): string {
  return value.replace(STYLED_LETTERS, (c) => c.normalize("NFKC"));
}

/** A header's raw value, unfolded onto one line, or null when it is missing. */
function headerValue(parsed: ParsedMail, name: string): string | null {
  return headerValues(parsed, name)[0] ?? null;
}

/** Every value of a header, top first, each unfolded onto one line. Empty ones are dropped. */
function headerValues(parsed: ParsedMail, name: string): string[] {
  return (parsed.headerLines ?? [])
    .filter((h) => h.key === name)
    .map((h) => h.line.slice(h.line.indexOf(":") + 1).replace(/\r?\n[ \t]+/g, " ").trim())
    .filter(Boolean);
}

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/; // anything else in a Reply-To (a quoted local part, junk) is not stored
const DOMAIN_MAX_CHARS = 253;

/** See NormalizedEmail.replyToDomain. A reply goes to every Reply-To address, so the first at another domain counts. */
export function replyToDomainOf(from: EmailAddress | null, replyTo: EmailAddress[]): string | null {
  const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).trim().toLowerCase();
  const own = from && from.address.includes("@") ? domainOf(from.address) : null;
  for (const r of replyTo) {
    if (!r.address.includes("@")) continue;
    const domain = domainOf(r.address);
    if (domain !== own && domain.length <= DOMAIN_MAX_CHARS && DOMAIN.test(domain)) return domain;
  }
  return null;
}

/** See NormalizedEmail.contentHash. Built from parsed parts, not raw bytes, which a server may re-wrap between folders. */
function contentHashOf(parsed: ParsedMail, text: string | null, subject: string | null): string {
  const files = parsed.attachments.map((a) => [a.filename ?? "", a.size, createHash("sha256").update(a.content).digest("hex")]);
  const from = addresses(parsed.from)[0]?.address ?? null;
  const parts = [parsed.date?.toISOString() ?? null, from, subject, text, typeof parsed.html === "string" ? parsed.html : null, files];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** One-line preview for the conversation list: the new text only, without quoted replies. */
export function previewOf(text: string | null, max = 160): string | null {
  if (!text) return null;
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*>/.test(line)) break; // quoted block
    if (/^On .+wrote:\s*$/.test(line.trim())) break; // "On Tue, ... wrote:"
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    lines.push(line);
  }
  const collapsed = lines
    .join(" ")
    .replace(/\[(?:https?:\/\/|mailto:|cid:)[^\]]*\]/gi, " ") // image and link targets the parser writes as [url]
    .replace(/(?:https?:\/\/|www\.)\S+/gi, " ") // bare links
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed) return null;
  return collapsed.length > max ? collapsed.slice(0, max - 1).trimEnd() + "…" : collapsed;
}

/** A readable name for an address with no display name: "sarah.okafor@x.com" becomes "Sarah Okafor". */
export function nameFromAddress(address: string): string {
  const local = address.split("@")[0] ?? address;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || address;
}

/** Parses raw email bytes and normalizes them. Links in images and HTML-from-text are skipped: never shown. */
export async function parseEmail(raw: Buffer, fallbackId: string, trustAuth?: AuthservTrust): Promise<NormalizedEmail> {
  return normalizeEmail(await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true }), fallbackId, trustAuth);
}
