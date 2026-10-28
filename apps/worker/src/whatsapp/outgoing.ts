// A reply with files becomes several WhatsApp messages, one per file, as when you attach them on your
// phone. The text rides as the caption of the first file that can carry one, else goes first on its
// own. Pure, so it can be unit tested.

import type { AnyMessageContent } from "baileys";
import type { OutgoingAttachment } from "../send/compose";

/** Photos WhatsApp shows inline. Others (HEIC, GIF, WebP, BMP) go as documents so nothing is lost. */
const PHOTO = /^image\/(jpeg|png)$/;
/** Videos every phone plays inline. */
const VIDEO = /^video\/(mp4|3gpp)$/;
const AUDIO = /^audio\//;

/** A file ready for WhatsApp. A voice note has been converted to Ogg Opus and carries its length and waveform. */
export type WhatsAppFile = OutgoingAttachment & { voice?: { seconds: number; waveform: Uint8Array } };

export function fileMessage(file: WhatsAppFile, caption?: string): AnyMessageContent {
  const mimetype = file.contentType;
  if (file.voice) {
    // Baileys sends the waveform it is given, though its types leave it out.
    const { seconds, waveform } = file.voice;
    return { audio: file.content, mimetype: "audio/ogg; codecs=opus", ptt: true, seconds, waveform } as AnyMessageContent;
  }
  if (PHOTO.test(mimetype)) return { image: file.content, mimetype, ...(caption ? { caption } : {}) };
  if (VIDEO.test(mimetype)) return { video: file.content, mimetype, ...(caption ? { caption } : {}) };
  if (AUDIO.test(mimetype)) return { audio: file.content, mimetype, ptt: false };
  return { document: file.content, mimetype, fileName: file.filename, ...(caption ? { caption } : {}) };
}

/** Everything one outbox row sends, in order. Empty when there is neither text nor a file. */
export function outgoingMessages(body: string, files: WhatsAppFile[]): AnyMessageContent[] {
  const text = body.trim();
  if (files.length === 0) return text ? [{ text }] : [];
  // Audio cannot carry a caption.
  const captioned = text ? files.findIndex((f) => !AUDIO.test(f.contentType)) : -1;
  const messages = files.map((f, i) => fileMessage(f, i === captioned ? text : undefined));
  return text && captioned < 0 ? [{ text }, ...messages] : messages;
}

/**
 * The number a new chat goes to: exactly one recipient, in E.164 (+ then 7 to 15 digits, no leading 0).
 * Returns its digits, or null when the row does not name one valid number.
 */
export function newChatNumber(to: string[]): string | null {
  if (to.length !== 1) return null;
  const number = to[0].trim();
  return /^\+[1-9][0-9]{6,14}$/.test(number) ? number.slice(1) : null;
}
