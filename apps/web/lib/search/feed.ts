// Reads the user's data from Supabase, opens it in the browser, and hands it to the index as documents: the whole message
// history a page at a time in the background, then notes, calendar events and tasks, and afterwards every change Realtime
// announces. This is the I/O half; deciding where each page starts is paging.ts and building documents is docs.ts, both
// tested without a network. Nothing read here is logged or sent anywhere except into the local index.

import { FIELD } from "@messages/crypto/fields";
import { allRows } from "../contacts";
import { loadNoteBodies, loadNotes } from "../notes";
import { openEvents, openMessages, openTasks } from "../open-rows";
import { supabase } from "../supabase";
import { open } from "../vault";
import { mapTask, TASK_COLUMNS } from "../tasks";
import { knownIds, removeDocs, removeMessages, saveMeta, stampsOf, upsertDocs } from "./client";
import { eventDoc, messageDocs, noteDoc, taskDoc, type MessageRow, type People } from "./docs";
import { docId, MAX_MESSAGES } from "./engine";
import { afterPage, startPass, type Cursor, type Saved } from "./paging";
import { bumpRev, setProgress } from "./status";

/** Messages read per request. */
const PAGE = 250;
/** Pause between pages (ms), so a long first build never competes with what the person is doing. */
const PAUSE_MS = 40;
const RETRIES = 3;
const NOTE_BODIES_AT_A_TIME = 20;
/** Realtime changes to messages are gathered this long (ms) so a burst becomes one read. */
const SETTLE_MS = 1000;

export interface FeedContext {
  people: People;
  cancelled: () => boolean;
}

const COLUMNS = "id, thread_id, direction, sender_contact_id, sender_address, to_addresses, sent_at, subject, body_text, is_bulk, provider_meta, transcript, attachments(id, filename, hidden)";
// Document cards (attachments.doc_card) come with their own migration; asking for the column before it exists fails the whole read.
const COLUMNS_WITH_CARDS = COLUMNS.replace("hidden)", "hidden, doc_card)");
let cardsPresent: Promise<boolean> | undefined;
const columns = async () => ((await (cardsPresent ??= (async () => (await supabase.from("attachments").select("doc_card").limit(0)).error?.code !== "42703")())) ? COLUMNS_WITH_CARDS : COLUMNS);

/** Opens the document cards nested in message rows, so the index holds their words and not their ciphertext. */
async function openCards(rows: MessageRow[]): Promise<MessageRow[]> {
  await Promise.all(rows.flatMap((r) => (r.attachments ?? []).map(async (a) => { if (a.doc_card) a.doc_card = await open(FIELD.docCard, a.doc_card).catch(() => null); })));
  return rows;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs a read again a few times with a growing pause, then lets the error out. */
async function retrying<T>(ctx: FeedContext, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await run(); } catch (error) {
      if (attempt >= RETRIES || ctx.cancelled()) throw error;
      await sleep(3000 * attempt);
    }
  }
}

async function messagePage(userId: string, cursor: Cursor | null): Promise<MessageRow[]> {
  // The user's own, as the Inbox list does: a colleague's work chat they can read is not theirs to search.
  let query = supabase.from("messages").select(await columns()).eq("user_id", userId);
  // Keyset paging on (sent_at, id), so messages sent in the same second are neither missed nor repeated.
  if (cursor) query = query.or(`sent_at.lt."${cursor.sentAt}",and(sent_at.eq."${cursor.sentAt}",id.lt.${cursor.id})`);
  const { data, error } = await query.order("sent_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE);
  if (error) throw error;
  return openCards((await openMessages(data as object[])) as unknown as MessageRow[]);
}

/** How many messages the user has, to say "of M". Null when it cannot be counted. */
export async function countMessages(userId: string): Promise<number | null> {
  const { count, error } = await supabase.from("messages").select("id", { count: "exact", head: true }).eq("user_id", userId);
  return error ? null : count;
}

/**
 * Pages through every message, newest first, into the index. Resumes where an earlier session stopped (saved) and tells
 * the caller how far it got after each page. Stops early on cancel, and at the memory cap, keeping the newest.
 */
export async function indexMessages(ctx: FeedContext, userId: string, saved: Saved, onSaved: (s: Saved) => void): Promise<void> {
  let pass = startPass(saved);
  for (;;) {
    if (ctx.cancelled()) return;
    const rows = await retrying(ctx, () => messagePage(userId, pass.cursor));
    if (ctx.cancelled()) return;
    const known = rows.length ? await knownIds(rows.map((r) => docId("message", r.id))) : [];
    const counts = await upsertDocs(rows.flatMap((r) => messageDocs(r, ctx.people)));
    const last = rows.at(-1);
    const step = afterPage(pass, { last: last ? { sentAt: last.sent_at, id: last.id } : null, size: rows.length, limit: PAGE, allKnown: known.length === rows.length });
    pass = step.pass;
    // Full: older messages would only push out the ones just added, so this is as far back as the index goes.
    const full = counts.messages >= MAX_MESSAGES - PAGE;
    onSaved(full ? { cursor: pass.saved.cursor, done: true } : pass.saved);
    setProgress({ indexed: counts.messages });
    bumpRev();
    if (step.finished || full) return;
    await sleep(PAUSE_MS);
  }
}

/** Catches up on notes: any that changed since they were indexed are read again, and deleted ones are dropped. */
export async function indexNotes(ctx: FeedContext): Promise<void> {
  const list = await loadNotes();
  const stamps = new Map(await stampsOf("note"));
  const stale = list.filter((n) => stamps.get(n.id) !== Date.parse(n.updatedAt));
  for (let i = 0; i < stale.length; i += NOTE_BODIES_AT_A_TIME) {
    if (ctx.cancelled()) return;
    const chunk = stale.slice(i, i + NOTE_BODIES_AT_A_TIME);
    const bodies = await loadNoteBodies(chunk.map((n) => n.id)).catch(() => new Map<string, { body: string }>());
    await upsertDocs(chunk.map((n) => noteDoc({ ...n, body: bodies.get(n.id)?.body ?? "" })));
  }
  const live = new Set(list.map((n) => n.id));
  const gone = [...stamps.keys()].filter((id) => !live.has(id)).map((id) => docId("note", id));
  if (gone.length) await removeDocs(gone);
  bumpRev();
}

/** Reads every calendar event again (a few thousand rows at most) and drops ones that were deleted. */
export async function indexEvents(ctx: FeedContext): Promise<void> {
  const rows = await allRows("Index events", (from, to) =>
    supabase.from("calendar_events").select("id, title, starts_at, location, calendar_name, description, attendees").order("starts_at").order("id").range(from, to));
  if (ctx.cancelled()) return;
  await openEvents(rows);
  await upsertDocs(rows.map((r) => eventDoc(r)));
  const live = new Set(rows.map((r) => r.id));
  const gone = (await stampsOf("event")).map(([id]) => id).filter((id) => !live.has(id)).map((id) => docId("event", id));
  if (gone.length) await removeDocs(gone);
  bumpRev();
}

/** Reads every task, dated or not (the app's own list holds only dated ones), and drops ones that were deleted. */
export async function indexTasks(ctx: FeedContext): Promise<void> {
  const rows = await allRows("Index tasks", (from, to) => supabase.from("tasks").select(TASK_COLUMNS).order("id").range(from, to));
  if (ctx.cancelled()) return;
  await openTasks(rows);
  await upsertDocs(rows.map((r) => taskDoc(mapTask(r))));
  const live = new Set(rows.map((r) => r.id));
  const gone = (await stampsOf("task")).map(([id]) => id).filter((id) => !live.has(id)).map((id) => docId("task", id));
  if (gone.length) await removeDocs(gone);
  bumpRev();
}

/** Saves where the message history has got to, sealed with the index. */
export const rememberProgress = (saved: Saved) => saveMeta({ messages: saved });

/** Reads these messages again by id, for changes announced by Realtime. */
async function messagesById(userId: string, ids: string[]): Promise<MessageRow[]> {
  const { data, error } = await supabase.from("messages").select(await columns()).eq("user_id", userId).in("id", ids);
  if (error) throw error;
  return openCards((await openMessages(data as object[])) as unknown as MessageRow[]);
}

/**
 * Keeps the index current: a new, edited or deleted message, note or event is reflected within a couple of seconds.
 * Each table has its own channel, so one that is not published for Realtime cannot stop the others. Returns a stop function.
 */
export function watchChanges(userId: string, ctx: FeedContext): () => void {
  const mine = `user_id=eq.${userId}`;
  const queue = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timers: ReturnType<typeof setTimeout>[] = [];

  async function flush() {
    timer = undefined;
    const ids = [...queue];
    queue.clear();
    try {
      for (let i = 0; i < ids.length && !ctx.cancelled(); i += 100) {
        const rows = await messagesById(userId, ids.slice(i, i + 100));
        await upsertDocs(rows.flatMap((r) => messageDocs(r, ctx.people)));
      }
      bumpRev();
    } catch {
      // The next change, or the catch-up when the tab comes back, picks it up.
    }
  }

  // Runs `work` a little after the last change, once.
  function later(ms: number, work: () => Promise<void>): () => void {
    let t: ReturnType<typeof setTimeout> | undefined;
    return () => {
      clearTimeout(t);
      t = setTimeout(() => { if (!ctx.cancelled()) void work().catch(() => undefined); }, ms);
      timers.push(t);
    };
  }
  const reindexNotes = later(1500, () => indexNotes(ctx));
  const reindexEvents = later(3000, () => indexEvents(ctx));

  function channel(name: string, tables: { table: string; onChange: (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => void }[]) {
    let ch = supabase.channel(`${name}-${userId}`);
    for (const { table, onChange } of tables) {
      // Realtime cannot filter deletions by user, so every deletion by anyone arrives and only ids held here matter.
      ch = ch.on("postgres_changes", { event: "DELETE", schema: "public", table }, (p) => onChange(p as never));
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table, filter: mine }, (p) => { if (p.eventType !== "DELETE") onChange(p as never); });
    }
    let joined = false;
    let errors = 0;
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") { joined = true; errors = 0; }
      // A table that is not published for Realtime never joins; after a few tries it is left alone.
      else if (status === "CHANNEL_ERROR" && !joined && ++errors >= 3) void supabase.removeChannel(ch);
    });
    return ch;
  }

  const channels = [
    channel("search-messages", [{
      table: "messages",
      onChange: (p) => {
        if (p.eventType === "DELETE") { const id = p.old?.id; if (typeof id === "string") void removeMessages([id]).then(bumpRev).catch(() => undefined); return; }
        const id = p.new?.id;
        if (typeof id !== "string") return;
        queue.add(id);
        clearTimeout(timer);
        timer = setTimeout(() => void flush(), SETTLE_MS);
      },
    }]),
    // A card made later by the AI worker changes only the file's row, so the message it came with is read again.
    channel("search-files", [{
      table: "attachments",
      onChange: (p) => {
        const id = p.new?.message_id;
        if (p.eventType === "DELETE" || typeof id !== "string") return;
        queue.add(id);
        clearTimeout(timer);
        timer = setTimeout(() => void flush(), SETTLE_MS);
      },
    }]),
    channel("search-notes", [{ table: "notes", onChange: reindexNotes }]),
    channel("search-events", [{ table: "calendar_events", onChange: reindexEvents }]),
  ];

  return () => {
    clearTimeout(timer);
    for (const t of timers) clearTimeout(t);
    for (const ch of channels) void supabase.removeChannel(ch);
  };
}
