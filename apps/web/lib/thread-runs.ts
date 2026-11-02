// Pure layout of a conversation's messages: photos gathered into albums, and the day groups of same-sender runs with
// meetings placed between them. No React; the message list (thread-view/message-list.tsx) renders what this returns.

import type { Attachment, Message } from "./types";
import type { Meeting } from "./meeting-text";
import { dayLabel } from "./format";

/** How close together photos must be sent to show as one album, as WhatsApp groups them. */
export const ALBUM_GAP_MS = 2 * 60_000;

/** A photo sent on its own: images only (no stickers), no words, no quote, not deleted or still sending. */
export function photoOnly(m: Message, isSticker: (a: Attachment) => boolean) {
  return !!m.attachments?.length && m.attachments.every((a) => a.kind === "image" && !isSticker(a))
    && !m.body.trim() && !m.quote && !m.quoted && !m.deleted && !m.sendState;
}

/** A run's messages, with photos sent one after another within a couple of minutes gathered into albums. */
export function withAlbums(run: Message[], isSticker: (a: Attachment) => boolean): Message[][] {
  const out: Message[][] = [];
  for (const m of run) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && photoOnly(prev, isSticker) && photoOnly(m, isSticker) && Date.parse(m.sentAt) - Date.parse(prev.sentAt) <= ALBUM_GAP_MS) last.push(m);
    else out.push([m]);
  }
  return out;
}

/** One day of a conversation: its label and its runs (consecutive messages from one sender, or a meeting). */
export type DayGroup = { key: string; day: string; runs: (Message[] | Meeting)[] };

/**
 * Splits each day into runs of consecutive messages from the same sender, with a meeting between the messages sent
 * before and after it starts (and so ending a run). `keys` is updated in place: a run keeps the key of any message it
 * already held, so prepending older messages or appending new ones from the same sender does not remount it (which
 * would lose an open View Original dialog, a playing voice note, Show Full Text).
 */
export function groupByDay(msgs: Message[], meetings: Meeting[], keys: Map<string, string>, now = new Date()): DayGroup[] {
  const out: DayGroup[] = [];
  const dayOf = (iso: string) => {
    const key = new Date(iso).toDateString();
    let g = out[out.length - 1];
    if (!g || g.key !== key) {
      g = { key, day: dayLabel(iso, now), runs: [] };
      out.push(g);
    }
    return g;
  };
  let next = 0;
  for (const m of msgs) {
    while (next < meetings.length && Date.parse(meetings[next].startedAt) <= Date.parse(m.sentAt)) {
      dayOf(meetings[next].startedAt).runs.push(meetings[next]);
      next++;
    }
    const g = dayOf(m.sentAt);
    const run = g.runs[g.runs.length - 1];
    if (Array.isArray(run) && run[0].from === m.from) run.push(m);
    else g.runs.push([m]);
  }
  for (; next < meetings.length; next++) dayOf(meetings[next].startedAt).runs.push(meetings[next]);
  // A run that splits (a meeting landing inside it) would hand both halves the same key; the second takes its own.
  const used = new Set<string>();
  for (const g of out) for (const run of g.runs) {
    if (!Array.isArray(run)) continue;
    const kept = run.map((m) => keys.get(m.id)).find((k) => k && !used.has(k));
    const key = kept ?? (used.has(run[0].id) ? `${run[0].id}:${run.length}` : run[0].id);
    used.add(key);
    for (const m of run) keys.set(m.id, key);
  }
  return out;
}
