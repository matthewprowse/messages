// Which attachments to keep out of the attachment lists. Pure, so it can be unit tested.
// The database adds a third reason, junk, from the conversation's triage (see the attachment_cleanup migration).

export type HiddenReason = "inline" | "tiny";

export interface AttachmentPart {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  content: Buffer;
  /** Content-ID without angle brackets. */
  contentId?: string;
  /** "inline" or "attachment", when the part says. */
  disposition?: string;
}

// Parts that are the email itself rather than a file: an AMP copy of the body, and the pieces of a
// bounce or delivery report.
const BODY_PARTS = new Set(["text/x-amp-html", "text/rfc822-headers", "message/delivery-status", "message/disposition-notification"]);

const TINY_BYTES = 15 * 1024;
const TINY_PIXELS = 100;
// An image the sender marked inline but the HTML never draws is still likely a logo when it is this small.
// Larger ones are usually photos pasted into the message, which people do want to see.
const SMALL_INLINE_BYTES = 50 * 1024;

/**
 * Why a part should be hidden, or null to show it:
 *   inline  an image the HTML draws by cid:, a small image marked inline or given a Content-ID,
 *           or another copy or part of the email itself (an AMP body, a bounce report's headers)
 *   tiny    an image under 15 KB, or under 100 by 100 pixels, unless it was sent as an attachment
 */
export function hiddenReasonOf(part: AttachmentPart, html: string | null): HiddenReason | null {
  const type = part.mimeType.toLowerCase();
  if (BODY_PARTS.has(type)) return "inline";
  if (!type.startsWith("image/")) return null;

  const body = html?.toLowerCase() ?? "";
  const drawn =
    (part.contentId && body.includes(`cid:${part.contentId.toLowerCase()}`)) ||
    (part.filename && body.includes(`cid:${part.filename.toLowerCase()}`));
  if (drawn) return "inline";
  if ((part.contentId || part.disposition === "inline") && part.sizeBytes < SMALL_INLINE_BYTES) return "inline";
  // A small image sent on purpose as an attachment (a QR ticket, a signature scan) stays visible.
  if (part.disposition === "attachment" && !part.contentId) return null;

  if (part.sizeBytes < TINY_BYTES) return "tiny";
  const size = imageSize(part.content);
  if (size && size.width < TINY_PIXELS && size.height < TINY_PIXELS) return "tiny";
  return null;
}

/** Width and height read from a PNG, GIF, JPEG or WebP header, or null for anything else. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString("ascii", 12, 16) === "IHDR") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 10 && buf.toString("ascii", 0, 3) === "GIF") {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    // Walk the JPEG segments to the first start-of-frame marker, which holds the size.
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = buf.readUInt16BE(i + 2);
      const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (frame) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + length;
    }
  }
  return null;
}
