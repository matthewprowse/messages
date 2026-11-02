// Pure helpers behind the attachment tiles, viewer and grid: labels, file name and swipe maths, the viewer's
// "not kept" wording and the grid's month headings. No React, so they are tested here; the views that use them
// are in components/attachments/.

import { FETCH_TEXT } from "./attachment-fetch";
import type { Attachment, FiledAttachment, Provider } from "./types";

export const KIND_LABEL: Record<Attachment["kind"], string> = { image: "Image", pdf: "PDF", video: "Video", audio: "Audio", file: "File" };

export const HIDDEN_LABEL: Record<NonNullable<Attachment["hiddenReason"]>, string> = {
  inline: "Inline Image",
  tiny: "Tiny Image",
  junk: "From Junk",
  manual: "Hidden",
};

/** Where a file came from, for the filter and the icon on a tile. */
export type Source = "gmail" | "whatsapp" | "icloud" | "imap";
export const SOURCE_LABEL: Record<Source, string> = { gmail: "Gmail", whatsapp: "WhatsApp", icloud: "iCloud", imap: "Other Email" };
// Each service shows its own logo; other mail has none, so it gets a plain envelope.

export function sourceOf(provider: Provider | undefined): Source | undefined {
  return provider === "gmail" || provider === "whatsapp" || provider === "icloud" || provider === "imap" ? provider : undefined;
}

/** The private storage bucket attachments live in. */
export const ATTACHMENT_BUCKET = "attachments";
// The viewer wants a link with half its hour left, so a video or long PDF kept open keeps working.
export const VIEW_MIN_LEFT_MS = 30 * 60 * 1000;

const SWIPE_MIN = 60; // px, the least a drag must travel to count as a swipe

/** The upper case extension ("PDF"), or "" when the name has none or the tail is too long to be one. */
export function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot > name.length - 7 ? name.slice(dot + 1).toUpperCase() : "";
}

/** A WhatsApp sticker, stored as Sticker.webp and the like. */
export function isSticker(a: Attachment) {
  return a.kind === "image" && a.name.startsWith("Sticker.");
}

/** -1 (previous) or 1 (next) for a quick, mostly horizontal drag, otherwise 0. */
export function swipeOf(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

// The download link is the viewing link told to save under the file's own name, so opening a file
// costs one batched signed link (often already cached by its thumbnail) and no second request.
export function downloadLink(view: string, name: string) {
  const url = new URL(view);
  url.searchParams.set("download", name);
  return url.toString();
}

/** What the viewer says when there is no stored copy. A big video and a full seat each say why. */
export function notKeptMessage(a: Attachment, notStored: boolean): string {
  if (a.notKept === "unavailable") return FETCH_TEXT.gone;
  if (a.notKept === "deferred") return "Not Downloaded. It Is Fetched From Your Mailbox When You Open It.";
  if (a.notKept === "video_link") return "Not Kept Here. Large Videos Stay at the Original. Open It in Your Mailbox or Chat.";
  if (a.notKept === "over_cap") return "Not Kept Here. Your Storage Is Full. The Original Is in Your Mailbox or Chat.";
  return notStored ? "Not Kept Here. The Original Is in Your Mailbox or Chat." : "Not Downloaded Yet. If It Stays Empty, the Original Is in Your Mailbox or Chat.";
}

export const messageHref = (a: FiledAttachment) => `/inbox/${a.threadId}?message=${a.messageId}`;

/** "2026-10": the month a file is grouped under in the grid. */
export const monthKey = (iso: string) => iso.slice(0, 7);
export const monthTitle = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
/** "1 File" or "2,500 Files", the count in the browser's locale. */
export const filesLabel = (n: number) => `${n.toLocaleString()} ${n === 1 ? "File" : "Files"}`;
