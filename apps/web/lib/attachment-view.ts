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

/** What each badge means, shown as its tooltip. */
export const HIDDEN_HINT: Record<NonNullable<Attachment["hiddenReason"]>, string> = {
  inline: "Drawn inside the email itself, such as a logo or signature",
  tiny: "Too small to be a photo, usually an icon or tracking pixel",
  junk: "From a conversation marked as junk",
  manual: "Hidden by you",
};

/** Where a file came from, for the Source filter. Any connected provider that can carry files has an entry. */
export type Source = Provider;
export const SOURCE_LABEL: Partial<Record<Provider, string>> = {
  gmail: "Gmail", outlook: "Outlook", icloud: "iCloud", imap: "Other Email", whatsapp: "WhatsApp", linkedin: "LinkedIn", instagram: "Instagram",
  teams: "Microsoft Teams", zoom: "Zoom", google_meet: "Google Meet",
};

/** The provider a file came through when it can carry files, else undefined (a calendar or task provider never does). */
export function sourceOf(provider: Provider | undefined): Source | undefined {
  return provider && provider in SOURCE_LABEL ? provider : undefined;
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
  if (a.notKept === "deferred") return "Not downloaded. It is fetched from your mailbox when you open it.";
  if (a.notKept === "video_link") return "Not kept here. Large videos stay at the original. Open it in your mailbox or chat.";
  if (a.notKept === "over_cap") return "Not kept here. Your storage is full. The original is in your mailbox or chat.";
  return notStored ? "Not kept here. The original is in your mailbox or chat." : "Not downloaded yet. If it stays empty, the original is in your mailbox or chat.";
}

export const messageHref = (a: FiledAttachment) => `/inbox/${a.threadId}?message=${a.messageId}`;

/** "2026-10": the month a file is grouped under in the grid, in the viewer's own time zone so it matches the heading. */
export function monthKey(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 7) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export const monthTitle = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
/** "1 File" or "2,500 Files", the count in the browser's locale. */
export const filesLabel = (n: number) => `${n.toLocaleString()} ${n === 1 ? "File" : "Files"}`;
