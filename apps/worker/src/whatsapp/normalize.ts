// Turns a WhatsApp message into what the app stores: a text body, a one-line preview, at most one media
// file, and the message it quotes. Pure functions, so they can be unit tested without a connection.

import { getContentType, jidDecode, normalizeMessageContent, type proto } from "baileys";

export type MediaType = "imageMessage" | "videoMessage" | "ptvMessage" | "audioMessage" | "documentMessage" | "stickerMessage";

export interface MediaInfo {
  type: MediaType;
  filename: string;
  mimeType: string;
  /** The attachments table's kind: image, pdf, video, audio or file. */
  kind: "image" | "pdf" | "video" | "audio" | "file";
  sizeBytes: number | null;
}

export type Described =
  | {
      kind: "message";
      /** WhatsApp's name for the content, e.g. imageMessage. */
      type: string;
      text: string;
      preview: string;
      media: MediaInfo | null;
      quoted: Quoted | null;
      mentions: string[];
      /** A type not shown here yet: the text says to open WhatsApp. */
      unsupported?: boolean;
      /** A call line from the call log; `missed` when nobody picked up, `declined` when it was turned down, `seconds` how long an answered one lasted. Shown as a line, not a bubble. */
      call?: CallInfo;
      /** A poll: its vote key (needed to read the votes that follow) and whether several options may be picked. */
      poll?: { secret: Uint8Array | null; multi: boolean };
    }
  | { kind: "reaction"; targetId: string; emoji: string }
  /** Edits, deletions and other protocol messages arrive separately as updates. Key sharing and group notices are not shown. Votes (pollUpdateMessage) are read by polls.ts. */
  | { kind: "skip" };

export interface Quoted {
  id: string;
  /** Who wrote the quoted message, as a JID. */
  participant: string | null;
  text: string;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "application/pdf": "pdf",
};

function extension(mimeType: string, fallback: string): string {
  return EXT[mimeType.split(";")[0].trim().toLowerCase()] ?? fallback;
}

function kindOf(mimeType: string): MediaInfo["kind"] {
  const m = mimeType.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf") return "pdf";
  return "file";
}

function size(value: number | Long | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : Number(value.toString());
}

type Long = { toString(): string };

/** First line of text, trimmed to fit a list row. */
export function oneLine(text: string, max = 160): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** What a message says, in a few words, for previews and for quotes of it. */
function summary(content: proto.IMessage): string {
  const d = describe(content);
  if (d.kind !== "message") return "";
  return d.text ? oneLine(d.text, 100) : d.preview;
}

export function describe(raw: proto.IMessage | null | undefined): Described {
  const content = normalizeMessageContent(unwrapMore(raw));
  if (!content) return { kind: "skip" };
  if (content.reactionMessage) {
    const r = content.reactionMessage;
    return r.key?.id ? { kind: "reaction", targetId: r.key.id, emoji: r.text ?? "" } : { kind: "skip" };
  }

  // Baileys misses call logs: the field's name is spelled "Messsage" in WhatsApp's protocol, so it is not recognised as a message.
  const type = getContentType(content) ?? (content.callLogMesssage ? "callLogMesssage" : undefined);
  if (!type) return { kind: "skip" };

  let text = "";
  let preview = "";
  let media: MediaInfo | null = null;
  let unsupported = false;
  let call: CallInfo | undefined;
  let poll: { secret: Uint8Array | null; multi: boolean } | undefined;
  let context: proto.IContextInfo | null | undefined;

  switch (type) {
    case "conversation":
      text = content.conversation ?? "";
      break;
    case "extendedTextMessage":
      text = content.extendedTextMessage?.text ?? "";
      context = content.extendedTextMessage?.contextInfo;
      break;
    case "imageMessage": {
      const m = content.imageMessage!;
      const mime = m.mimetype ?? "image/jpeg";
      text = m.caption ?? "";
      preview = "Photo";
      media = { type, filename: `Photo.${extension(mime, "jpg")}`, mimeType: mime, kind: "image", sizeBytes: size(m.fileLength) };
      context = m.contextInfo;
      break;
    }
    case "videoMessage":
    case "ptvMessage": {
      const m = (content.videoMessage ?? content.ptvMessage)!;
      const mime = m.mimetype ?? "video/mp4";
      text = m.caption ?? "";
      preview = type === "ptvMessage" ? "Video Note" : m.gifPlayback ? "GIF" : "Video";
      media = { type, filename: `${preview}.${extension(mime, "mp4")}`, mimeType: mime, kind: "video", sizeBytes: size(m.fileLength) };
      context = m.contextInfo;
      break;
    }
    case "audioMessage": {
      const m = content.audioMessage!;
      const mime = m.mimetype ?? "audio/ogg";
      const seconds = m.seconds ?? 0;
      const length = seconds ? ` (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")})` : "";
      preview = `${m.ptt ? "Voice Note" : "Audio"}${length}`;
      media = { type, filename: `${m.ptt ? "Voice Note" : "Audio"}.${extension(mime, "ogg")}`, mimeType: mime, kind: "audio", sizeBytes: size(m.fileLength) };
      context = m.contextInfo;
      break;
    }
    case "documentMessage": {
      const m = content.documentMessage!;
      const mime = m.mimetype ?? "application/octet-stream";
      const name = m.fileName?.trim() || m.title?.trim() || `Document.${extension(mime, "bin")}`;
      text = m.caption ?? "";
      preview = `Document: ${name}`;
      media = { type, filename: name, mimeType: mime, kind: kindOf(mime), sizeBytes: size(m.fileLength) };
      context = m.contextInfo;
      break;
    }
    case "stickerMessage": {
      const m = content.stickerMessage!;
      const mime = m.mimetype ?? "image/webp";
      preview = "Sticker";
      media = { type, filename: `Sticker.${extension(mime, "webp")}`, mimeType: mime, kind: "image", sizeBytes: size(m.fileLength) };
      context = m.contextInfo;
      break;
    }
    case "locationMessage":
    case "liveLocationMessage": {
      const m = (content.locationMessage ?? content.liveLocationMessage)!;
      const place = "name" in m ? [m.name, m.address].filter(Boolean).join(", ") : "";
      const where = m.degreesLatitude != null && m.degreesLongitude != null ? `https://maps.google.com/?q=${m.degreesLatitude},${m.degreesLongitude}` : "";
      preview = type === "liveLocationMessage" ? "Live Location" : "Location";
      text = [place ? `${preview}: ${place}` : preview, where].filter(Boolean).join("\n");
      context = m.contextInfo;
      break;
    }
    case "contactMessage":
      text = `Contact: ${content.contactMessage?.displayName ?? "Shared contact"}`;
      context = content.contactMessage?.contextInfo;
      break;
    case "contactsArrayMessage":
      text = `Contacts: ${(content.contactsArrayMessage?.contacts ?? []).map((c) => c.displayName).filter(Boolean).join(", ")}`;
      context = content.contactsArrayMessage?.contextInfo;
      break;
    case "pollCreationMessage":
    case "pollCreationMessageV2":
    case "pollCreationMessageV3": {
      const m = (content.pollCreationMessage ?? content.pollCreationMessageV2 ?? content.pollCreationMessageV3)!;
      text = pollText(m.name ?? "", (m.options ?? []).map((o) => o.optionName ?? ""));
      poll = { secret: raw?.messageContextInfo?.messageSecret ?? content.messageContextInfo?.messageSecret ?? null, multi: (m.selectableOptionsCount ?? 0) !== 1 };
      context = m.contextInfo;
      break;
    }
    case "eventMessage":
      text = `Event: ${content.eventMessage?.name ?? ""}`;
      context = content.eventMessage?.contextInfo;
      break;
    case "groupInviteMessage":
      text = `Group Invite: ${content.groupInviteMessage?.groupName ?? ""}`;
      context = content.groupInviteMessage?.contextInfo;
      break;
    case "scheduledCallCreationMessage":
      text = `Scheduled Call: ${content.scheduledCallCreationMessage?.title ?? ""}`;
      break;
    case "callLogMesssage": {
      const log = content.callLogMesssage!;
      const video = !!log.isVideo;
      const missed = log.callOutcome === CALL_MISSED;
      const declined = log.callOutcome === CALL_DECLINED;
      const seconds = Number(log.durationSecs ?? 0);
      const kind = video ? "Video Call" : "Voice Call";
      text = missed ? `Missed ${kind}` : declined ? `Declined ${kind}` : seconds > 0 ? `${kind}, ${callLength(seconds)}` : kind;
      call = { video, missed, ...(declined ? { declined } : {}), ...(seconds > 0 ? { seconds } : {}) };
      break;
    }
    case "interactiveMessage":
      text = [content.interactiveMessage?.header?.title, content.interactiveMessage?.body?.text, content.interactiveMessage?.footer?.text].filter(Boolean).join("\n");
      context = content.interactiveMessage?.contextInfo;
      break;
    case "buttonsMessage":
      text = [content.buttonsMessage?.contentText, content.buttonsMessage?.footerText].filter(Boolean).join("\n");
      context = content.buttonsMessage?.contextInfo;
      break;
    case "templateMessage": {
      const t = content.templateMessage?.hydratedTemplate ?? content.templateMessage?.hydratedFourRowTemplate;
      text = [t?.hydratedTitleText, t?.hydratedContentText, t?.hydratedFooterText].filter(Boolean).join("\n");
      break;
    }
    case "listMessage":
      text = [content.listMessage?.title, content.listMessage?.description].filter(Boolean).join("\n");
      context = content.listMessage?.contextInfo;
      break;
    case "buttonsResponseMessage":
      text = content.buttonsResponseMessage?.selectedDisplayText ?? "";
      context = content.buttonsResponseMessage?.contextInfo;
      break;
    case "listResponseMessage":
      text = content.listResponseMessage?.title ?? "";
      context = content.listResponseMessage?.contextInfo;
      break;
    case "templateButtonReplyMessage":
      text = content.templateButtonReplyMessage?.selectedDisplayText ?? "";
      context = content.templateButtonReplyMessage?.contextInfo;
      break;
    case "albumMessage": // the photos follow as their own messages
    case "messageHistoryBundle":
    case "messageHistoryNotice":
    case "placeholderMessage":
    case "protocolMessage":
    case "senderKeyDistributionMessage":
    case "messageContextInfo":
    case "keepInChatMessage":
    case "pinInChatMessage":
    case "encReactionMessage":
    case "encEventResponseMessage":
    case "pollUpdateMessage": // a vote: stored on its poll by polls.ts, not as a message
    case "call":
      return { kind: "skip" };
    default:
      text = "This message type is not shown here. Open WhatsApp to see it.";
      unsupported = true;
  }
  if (!text && !media && !preview) {
    text = "This message type is not shown here. Open WhatsApp to see it.";
    unsupported = true;
  }

  let quoted: Quoted | null = null;
  if (context?.quotedMessage && context.stanzaId) {
    quoted = { id: context.stanzaId, participant: context.participant ?? null, text: summary(context.quotedMessage) };
  }
  return {
    kind: "message",
    type,
    text,
    preview: oneLine(text) || preview,
    media,
    quoted,
    mentions: context?.mentionedJid ?? [],
    ...(unsupported ? { unsupported } : {}),
    ...(call ? { call } : {}),
    ...(poll ? { poll } : {}),
  };
}

/** callLogMesssage.callOutcome for a call nobody answered (proto.Message.CallLogMessage.CallOutcome.MISSED). */
export const CALL_MISSED = 1;
/** callLogMesssage.callOutcome for a call turned down (proto.Message.CallLogMessage.CallOutcome.REJECTED). */
export const CALL_DECLINED = 3;

/** A call line as stored in provider_meta.call. */
export interface CallInfo {
  video: boolean;
  missed: boolean;
  declined?: boolean;
  seconds?: number;
}

/** How long a call lasted, as the text kept for it: "45 Sec", "3 Min", "1 Hr 5 Min". */
export function callLength(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} Sec`;
  const min = Math.round(seconds / 60);
  return min < 60 ? `${min} Min` : `${Math.floor(min / 60)} Hr${min % 60 ? ` ${min % 60} Min` : ""}`;
}

/** A poll as the text kept for it: the question, then one bullet per option. polls.ts reads it back. */
export function pollText(name: string, options: string[]): string {
  return [`Poll: ${name}`, ...options.map((o) => `• ${o}`)].join("\n");
}

/** Wrappers Baileys does not unwrap itself: animated stickers and bot replies carry an ordinary message inside. */
function unwrapMore(raw: proto.IMessage | null | undefined): proto.IMessage | null | undefined {
  let content = raw;
  for (let i = 0; i < 3 && content; i++) {
    const inner = content.lottieStickerMessage?.message ?? content.botInvokeMessage?.message;
    if (!inner) break;
    content = inner;
  }
  return content;
}

/** "+447700900123" from "447700900123@s.whatsapp.net" (or with a device suffix). Null for anything else. */
export function e164(jid: string | null | undefined): string | null {
  const decoded = jid ? jidDecode(jid) : undefined;
  if (!decoded || (decoded.server !== "s.whatsapp.net" && decoded.server !== "hosted")) return null;
  return /^\d{6,15}$/.test(decoded.user) ? `+${decoded.user}` : null;
}

/** The phone number's digits for a pairing code request, or null when it cannot be a full international number. */
export function pairingDigits(input: string | null | undefined): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  return /^\d{7,15}$/.test(digits) ? digits : null;
}

/** "ABCD-EFGH", the way WhatsApp shows a pairing code. */
export function formatPairingCode(code: string): string {
  const c = code.replace(/[^0-9A-Z]/gi, "").toUpperCase();
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Replaces "@447700900123" mentions with "@Name" where the name is known. */
export function nameMentions(text: string, mentions: string[], nameOf: (jid: string) => string | null): string {
  let out = text;
  for (const jid of mentions) {
    const user = jidDecode(jid)?.user;
    const name = nameOf(jid);
    if (user && name) out = out.split(`@${user}`).join(`@${name}`);
  }
  return out;
}

/**
 * Which messages from a history batch are still unread on the phone: the newest `unreadCount` messages
 * from other people in each chat. Returns their IDs.
 */
export function unreadInHistory(
  messages: { id: string; chat: string; fromMe: boolean; at: number }[],
  unreadByChat: Map<string, number>,
): Set<string> {
  const unread = new Set<string>();
  const byChat = new Map<string, typeof messages>();
  for (const m of messages) if (!m.fromMe) byChat.set(m.chat, [...(byChat.get(m.chat) ?? []), m]);
  for (const [chat, list] of byChat) {
    const count = unreadByChat.get(chat) ?? 0;
    if (count <= 0) continue;
    for (const m of [...list].sort((a, b) => b.at - a.at).slice(0, count)) unread.add(m.id);
  }
  return unread;
}
