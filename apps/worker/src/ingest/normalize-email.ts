import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { hiddenReasonOf, type HiddenReason } from "./attachment-hidden";

// Pure conversion of a parsed MIME message into the shape we store. No I/O, so it can be unit tested.

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
export function normalizeEmail(parsed: ParsedMail, fallbackId: string): NormalizedEmail {
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
  const line = parsed.headerLines?.find((h) => h.key === name)?.line;
  if (!line) return null;
  const value = line.slice(line.indexOf(":") + 1).replace(/\r?\n[ \t]+/g, " ").trim();
  return value || null;
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
export async function parseEmail(raw: Buffer, fallbackId: string): Promise<NormalizedEmail> {
  return normalizeEmail(await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true }), fallbackId);
}
