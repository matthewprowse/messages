// Checks on where a WhatsApp file or profile picture is fetched from, and how much of it is read. Pure: no network, no
// database. A media message's `url` and `directPath` are written by whoever sent it, so only a checked path on WhatsApp's
// own media host is ever fetched (./media.ts), and every body is read with a hard byte cap (./media.ts, ./photos.ts).

import { extractMessageContent, getContentType, type MediaType as WAMediaType, type proto } from "baileys";

/** WhatsApp's media host, Baileys' default. Files are only ever fetched from a host under whatsapp.net. */
export const WA_MEDIA_HOST = "mmg.whatsapp.net";

/** What a real direct path looks like ("/v/t62.7118-24/..._n.enc?ccb=11-4&oh=...&oe=...&_nc_sid=...&mms3=true"). */
// One "/" to start, never two: "//evil.com/x" is a whole other host to a URL parser, which Baileys may use some day.
const DIRECT_PATH = /^\/(?!\/)[A-Za-z0-9/_\-.?=&%~]+$/;
const DIRECT_PATH_MAX = 4096; // characters; real ones are a few hundred

/**
 * The direct path when it is safe to put after WhatsApp's host, else null. It must start with one "/" and hold only
 * path and query characters: no "@", ":" or "\" that could move the request to another host.
 */
export function safeDirectPath(path: unknown): string | null {
  if (typeof path !== "string" || path.length > DIRECT_PATH_MAX || !DIRECT_PATH.test(path)) return null;
  return path;
}

const MEDIA_TYPES = new Set<string>(["imageMessage", "videoMessage", "ptvMessage", "audioMessage", "documentMessage", "stickerMessage"]);

/**
 * What to fetch a message's file with: its media type as Baileys names it, its key and a checked direct path. The
 * sender's `url` is left out on purpose, as Baileys fetches a bare one as given and takes the host from one next to a
 * path. Null when there is no file, no key or no safe path, which means the file is not fetched at all.
 */
export function downloadable(message: proto.IMessage | null | undefined): { type: WAMediaType; mediaKey: Uint8Array; directPath: string } | null {
  const content = extractMessageContent(message);
  const type = getContentType(content);
  if (!type || !MEDIA_TYPES.has(type)) return null;
  const media = content?.[type] as proto.Message.IImageMessage | null | undefined;
  const directPath = safeDirectPath(media?.directPath);
  if (!media?.mediaKey?.length || !directPath) return null;
  // Baileys keys its decryption by the type without "Message" ("image", "ptv"), as its own download does.
  return { type: type.replace("Message", "") as WAMediaType, mediaKey: media.mediaKey, directPath };
}

/** True for a hostname under whatsapp.net, the only place files and pictures are fetched from. */
export function isWhatsAppHost(host: unknown): host is string {
  return typeof host === "string" && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.whatsapp\.net$/i.test(host);
}

/** The media host to fetch from: the one the socket was given when it is under whatsapp.net, else the default. */
export function mediaHost(given: unknown): string {
  return isWhatsAppHost(given) ? given : WA_MEDIA_HOST;
}

/** True for an https link on a whatsapp.net host with no login part or odd port, as profile picture links are. */
export function isWhatsAppPhotoUrl(link: unknown): boolean {
  if (typeof link !== "string") return false;
  try {
    const u = new URL(link);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && isWhatsAppHost(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Reads a body into memory, stopping as soon as it passes `maxBytes`. Returns null when it is too large; leaving the loop
 * early destroys a Node stream or cancels a web stream, which ends the download.
 */
export async function readCapped(chunks: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Buffer | null> {
  const parts: Buffer[] = [];
  let total = 0;
  for await (const chunk of chunks) {
    total += chunk.length;
    if (total > maxBytes) return null;
    parts.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length));
  }
  return Buffer.concat(parts, total);
}
