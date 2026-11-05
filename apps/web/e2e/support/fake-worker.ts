// The fake worker (docs/TESTING.md, The Safety Rule, point 2): no sync or AI worker ever runs against Konva Test, so the
// rows the app queues for one stay queued until a test looks at them. These helpers play the worker's part: each first checks
// that the row the app should have queued is there (a missing one fails the test, naming the table), then marks it as the
// worker would after doing the work, with the service role, so the screens after it can be tested. Nothing here talks to a
// provider. Only the project user's rows are read or changed. Arrivals of new mail are in fake-incoming.ts.

import { randomUUID } from "node:crypto";
import { admin } from "./admin";
import { FIELD, openText, seal } from "./seal";
import { testUserId, type ProjectName } from "./users";

// How often to look again while waiting for the app to queue something, and the default wait.
const POLL_MS = 250;
const WAIT_MS = 15_000;

/** Looks every POLL_MS until `look` finds something, or throws `none` after timeoutMs. */
export async function poll<T>(look: () => Promise<T | null | undefined>, none: string, timeoutMs = WAIT_MS): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const found = await look();
    if (found) return found;
    if (Date.now() > until) throw new Error(`${none} (within ${timeoutMs} ms)`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

const fail = (what: string, error: { code?: string }) => Object.assign(new Error(`Could not ${what}.`), { code: error.code });

// ---- mail_actions: read receipts, archive, delete and the like ------------------------------------------------------

/** A queued mail action as a test sees it. */
export interface MailAction {
  id: string;
  action: string;
  status: string;
}

/** The newest mail action of a kind queued for a conversation, waiting for the app to queue it. Throws if it never does. */
export async function waitForMailAction(project: ProjectName, threadId: string, action: string, timeoutMs = WAIT_MS): Promise<MailAction> {
  const userId = await testUserId(project);
  return poll(async () => {
    const { data, error } = await admin().from("mail_actions").select("id, action, status").eq("user_id", userId).eq("thread_id", threadId).eq("action", action)
      .order("created_at", { ascending: false }).limit(1);
    if (error) throw fail("read mail_actions", error);
    return data[0];
  }, `No "${action}" mail action was queued for the conversation`, timeoutMs);
}

/** Every mail action of a kind queued for these conversations, once there is one for each. */
export async function waitForMailActions(project: ProjectName, threadIds: string[], action: string, timeoutMs = WAIT_MS): Promise<MailAction[]> {
  return Promise.all(threadIds.map((id) => waitForMailAction(project, id, action, timeoutMs)));
}

/** Marks mail actions done as the worker does once the mail server has the change (status done, claimed and done times). */
export async function completeMailActions(project: ProjectName, ids: string[]): Promise<MailAction[]> {
  const userId = await testUserId(project);
  const at = new Date().toISOString();
  const { data, error } = await admin().from("mail_actions").update({ status: "done", claimed_at: at, done_at: at }).eq("user_id", userId).eq("status", "queued").in("id", ids)
    .select("id, action, status");
  if (error) throw fail("complete mail actions", error);
  if (data.length !== ids.length) throw new Error(`${ids.length - data.length} of ${ids.length} mail actions were not queued, so the worker would not have taken them.`);
  return data;
}

/** A conversation's unread count as the database has it now. */
export async function unreadCount(project: ProjectName, threadId: string): Promise<number> {
  const userId = await testUserId(project);
  const { data, error } = await admin().from("threads").select("unread_count").eq("user_id", userId).eq("id", threadId).single();
  if (error) throw fail("read the conversation", error);
  return data.unread_count;
}

// ---- outbox: replies and new messages -------------------------------------------------------------------------------

/** A reply or new message in the outbox, its text opened. */
export interface Queued {
  id: string;
  status: string;
  body: string;
  threadId: string | null;
  sendAfter: string | null;
  createdAt: string;
  error: string | null;
}

async function outboxRows(project: ProjectName, filter: { threadId?: string; status?: string }): Promise<Queued[]> {
  const userId = await testUserId(project);
  let q = admin().from("outbox").select("id, status, body, thread_id, send_after, created_at, error").eq("user_id", userId);
  if (filter.threadId) q = q.eq("thread_id", filter.threadId);
  if (filter.status) q = q.eq("status", filter.status);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(20);
  if (error) throw fail("read the outbox", error);
  return Promise.all(data.map(async (r) => ({ id: r.id, status: r.status, body: (await openText(userId, FIELD.body, r.body)) ?? "", threadId: r.thread_id, sendAfter: r.send_after, createdAt: r.created_at, error: r.error })));
}

/**
 * The outbox row holding exactly this text, waiting for the app to queue it. `threadId` narrows it to a conversation and
 * `status` to a state (a Retry queues the same text again, so the failed row and the new one are told apart by it).
 */
export async function waitForOutbox(project: ProjectName, text: string, where: { threadId?: string; status?: string } = {}, timeoutMs = WAIT_MS): Promise<Queued> {
  return poll(async () => (await outboxRows(project, where)).find((r) => r.body === text), "No outbox row with that text was queued", timeoutMs);
}

/** Whether an outbox row with this id is still there. */
export async function outboxExists(project: ProjectName, id: string): Promise<boolean> {
  const userId = await testUserId(project);
  const { data, error } = await admin().from("outbox").select("id").eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) throw fail("read the outbox", error);
  return !!data;
}

/** The outbox rows for a conversation, newest first. */
export const outboxFor = (project: ProjectName, threadId: string) => outboxRows(project, { threadId });

async function takeQueued(project: ProjectName, id: string): Promise<Queued> {
  const userId = await testUserId(project);
  const { data, error } = await admin().from("outbox").select("status").eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) throw fail("read the outbox", error);
  if (!data) throw new Error("The outbox row is not there, so no worker would have taken it.");
  if (data.status !== "queued" && data.status !== "sending") throw new Error(`The outbox row is ${data.status}, not queued, so no worker would have taken it.`);
  return (await outboxRows(project, {})).find((r) => r.id === id)!;
}

/**
 * Marks a queued reply sent as the worker does once the provider took it: status sent, the provider's id and the time.
 * The sent copy is stored separately (fake-incoming.ts storeSentCopy), as it arrives on the next sync.
 */
export async function markOutboxSent(project: ProjectName, id: string): Promise<Queued> {
  const row = await takeQueued(project, id);
  const { error } = await admin().from("outbox").update({ status: "sent", provider_message_id: `<sent-${randomUUID()}@example.com>`, sent_at: new Date().toISOString(), error: null }).eq("id", id);
  if (error) throw fail("mark the outbox row sent", error);
  return { ...row, status: "sent" };
}

/** Marks a queued reply failed with a reason the worker would give for a send that definitely did not go out. */
export async function markOutboxFailed(project: ProjectName, id: string, reason = "Nothing was sent. Try again."): Promise<Queued> {
  const row = await takeQueued(project, id);
  const { error } = await admin().from("outbox").update({ status: "failed", error: reason }).eq("id", id);
  if (error) throw fail("mark the outbox row failed", error);
  return { ...row, status: "failed", error: reason };
}

// ---- drafts ---------------------------------------------------------------------------------------------------------

/** A draft request waiting for the AI worker. */
export interface DraftRequest {
  id: string;
  threadId: string | null;
  tone: string;
  instruction: string | null;
}

/** The pending draft request for a conversation, waiting for the app to queue it. */
export async function waitForDraftRequest(project: ProjectName, threadId: string, timeoutMs = WAIT_MS): Promise<DraftRequest> {
  const userId = await testUserId(project);
  return poll(async () => {
    const { data, error } = await admin().from("drafts").select("id, thread_id, tone, instruction").eq("user_id", userId).eq("thread_id", threadId).eq("status", "pending")
      .order("created_at", { ascending: false }).limit(1);
    if (error) throw fail("read drafts", error);
    const row = data[0];
    return row && { id: row.id, threadId: row.thread_id, tone: row.tone, instruction: await openText(userId, FIELD.instruction, row.instruction) };
  }, "No draft request was queued for the conversation", timeoutMs);
}

/** Fills a pending draft with fixed text, as the AI worker does: sealed body, status active. Throws if it was not pending. */
export async function fillDraft(project: ProjectName, id: string, text: string): Promise<void> {
  const userId = await testUserId(project);
  const { data, error } = await admin().from("drafts").update({ body: (await seal(userId, FIELD.draft, text))!, status: "active", model: "fake", error: null })
    .eq("user_id", userId).eq("id", id).eq("status", "pending").select("id");
  if (error) throw fail("fill the draft", error);
  if (data.length !== 1) throw new Error("The draft was not pending, so the AI worker would not have filled it.");
}

// ---- the daily brief ------------------------------------------------------------------------------------------------

/** One second of silence as a WAV file, base64: the smallest audio a browser will decode. */
const SILENCE_WAV = (() => {
  const rate = 8000, samples = rate, data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]).toString("base64");
})();

/** Waits for a brief the app asked to have spoken (status speak_pending), then stores one silent audio part and marks it ready, as the AI worker does. */
export async function speakBrief(project: ProjectName, timeoutMs = WAIT_MS): Promise<void> {
  const userId = await testUserId(project);
  const brief = await poll(async () => (await admin().from("briefs").select("id").eq("user_id", userId).eq("status", "speak_pending").maybeSingle()).data, "No brief was asked to be spoken", timeoutMs);
  const part = await admin().from("brief_parts").insert({ brief_id: brief.id, user_id: userId, seq: 0, audio: (await seal(userId, FIELD.brief, SILENCE_WAV))!, seconds: 1 });
  if (part.error) throw fail("store the brief audio", part.error);
  const done = await admin().from("briefs").update({ status: "ready", parts: 1, seconds: 1, updated_at: new Date().toISOString() }).eq("id", brief.id);
  if (done.error) throw fail("mark the brief ready", done.error);
}
