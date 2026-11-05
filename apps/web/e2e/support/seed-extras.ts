// The rest of the seed, written the way the workers write it: what the AI worker leaves on mail it has triaged (message_ai
// rows and the same fields on the conversation, sealed summaries and choices), labels, a waiting AI draft, archived and
// snoozed conversations, follow-ups, tasks, calendar events, today's brief, promises, and replies already sent. Only the
// test user's rows. Column formats are the AI worker's (apps/ai/ai/triage.py) and the sync worker's.

import { FIELD, seal } from "./seal";
import type { Admin } from "./admin";
import { CONVERSATIONS, lastMessage } from "./fake-data";
import { BRIEF_SCRIPT, EVENTS, LABELS, PROMISES, SENT_REPLIES, TASKS } from "./fake-extras";
import type { World } from "./world";
import { allDay, at, dayIn } from "./time";

const must = <T>(what: string, r: { data: T; error: { code?: string } | null }): T => {
  if (r.error) throw Object.assign(new Error(`Seeding ${what} failed.`), { code: r.error.code });
  return r.data;
};

/** Triage results: a message_ai row on the latest incoming message, and the same fields on the conversation. */
async function seedAi(db: Admin, w: World) {
  await Promise.all(CONVERSATIONS.map(async (c) => {
    if (!c.ai) return;
    const incoming = c.messages.map((m, i) => ({ m, id: w.messages[c.key][i] })).filter((x) => x.m.from !== "me").at(-1)!;
    const ai = c.ai;
    const summary = (await seal(w.userId, FIELD.summary, ai.summary))!;
    // read_choices stores the options with the plan; a message with none stores NO_CHOICES, so the backfill skips it.
    const choices = ai.choices ? { asked: null, minutes: null, options: ai.choices.options, plan: ai.choices.plan } : { options: [] };
    must("message_ai", await db.from("message_ai").upsert({
      message_id: incoming.id, user_id: w.userId, priority: ai.priority, category: ai.category, summary, needs_reply: !!ai.needsReply, junk: !!ai.junk,
      reply_choices: await seal(w.userId, FIELD.choices, JSON.stringify(choices)), suspicious: ai.suspicious ?? null,
    }, { onConflict: "message_id" }));
    // needs_reply only counts while the user's answer is awaited, which is so for every conversation that has AI work here.
    must("a triaged conversation", await db.from("threads").update({
      priority: ai.priority, category: ai.category, summary, needs_reply: !!ai.needsReply && lastMessage(c).from !== "me", junk: !!ai.junk, suspicious: ai.suspicious ?? null,
    }).eq("id", w.threads[c.key]));
  }));
}

/** Labels, and the conversations that wear them. */
async function seedLabels(db: Admin, w: World) {
  const rows = must("labels", await db.from("labels").insert(LABELS.map((l) => ({ user_id: w.userId, name: l.name, color: l.color }))).select("id, name"))!;
  const id = new Map(rows.map((r) => [r.name, r.id]));
  const links = CONVERSATIONS.flatMap((c) => (c.labels ?? []).map((name) => ({ thread_id: w.threads[c.key], label_id: id.get(name)!, user_id: w.userId })));
  if (links.length) must("thread_labels", await db.from("thread_labels").insert(links));
}

/** An AI draft waiting, archived and snoozed conversations, and follow-ups that expect an answer. */
async function seedStates(db: Admin, w: World) {
  const now = Date.now();
  await Promise.all(CONVERSATIONS.map(async (c) => {
    const thread = w.threads[c.key];
    const last = w.messages[c.key].at(-1)!;
    if (c.draft) {
      must("a draft", await db.from("drafts").insert({
        user_id: w.userId, thread_id: thread, body: (await seal(w.userId, FIELD.draft, c.draft))!, tone: "default", status: "active", auto: true, for_message_id: last, model: "fake",
      }));
    }
    if (c.archived) must("an archived conversation", await db.from("threads").update({ status: "archived" }).eq("id", thread));
    if (c.snoozedDays) {
      must("a snoozed conversation", await db.from("threads").update({
        snoozed_until: new Date(now + c.snoozedDays * 86_400_000).toISOString(), snooze_kind: "snooze", snoozed_at: new Date(now).toISOString(),
      }).eq("id", thread));
    }
    if (c.waiting) must("a follow-up", await db.from("follow_ups").insert({ thread_id: thread, user_id: w.userId, message_id: last, expects_reply: true }));
  }));
}

/** Tasks (sealed title and list) and calendar events (sealed title, place, calendar name and guest list). */
async function seedPlanner(db: Admin, w: World, accounts: { tasks: string; calendar: string }) {
  const tasks = await Promise.all(TASKS.map(async (t, i) => ({
    user_id: w.userId, account_id: accounts.tasks, provider_task_id: `fake-task-${i}`, list_id: `fake-list-${t.list.toLowerCase()}`,
    list_name: await seal(w.userId, FIELD.taskList, t.list), title: (await seal(w.userId, FIELD.taskTitle, t.title))!, status: "open",
    due_at: (t.at ? at(t.dueDays, t.at) : allDay(t.dueDays)).toISOString(), due_all_day: !t.at, provider_meta: {},
  })));
  must("tasks", await db.from("tasks").insert(tasks));
  const events = await Promise.all(EVENTS.map(async (e, i) => {
    const start = e.at ? at(e.dueDays, e.at) : allDay(e.dueDays);
    const end = e.at ? new Date(start.getTime() + (e.minutes ?? 60) * 60_000) : allDay(e.dueDays + 1);
    return {
      user_id: w.userId, account_id: accounts.calendar, calendar_id: `fake-cal-${e.calendar.toLowerCase()}`, provider_event_id: `fake-event-${i}`,
      title: await seal(w.userId, FIELD.eventTitle, e.title), starts_at: start.toISOString(), ends_at: end.toISOString(), all_day: !e.at,
      location: await seal(w.userId, FIELD.eventLocation, e.location ?? null), calendar_name: await seal(w.userId, FIELD.calendarName, e.calendar),
      // The guest list is sealed whole, as one JSON string, in a jsonb column (lib/open-rows.ts openEvents).
      attendees: await seal(w.userId, FIELD.eventGuests, "[]"),
    };
  }));
  must("calendar events", await db.from("calendar_events").insert(events));
}

/** Today's brief (the script alone, as the morning brief is stored) and the promises the AI found. */
async function seedBriefAndPromises(db: Admin, w: World) {
  must("the brief", await db.from("briefs").insert({
    user_id: w.userId, for_date: dayIn(0), status: "written", script: await seal(w.userId, FIELD.brief, BRIEF_SCRIPT), voice: "Kore",
  }));
  const rows = await Promise.all(PROMISES.map(async (p, i) => ({
    user_id: w.userId, thread_id: w.threads[p.thread], message_id: w.messages[p.thread].at(-1)!, seq: i + 1, owner: p.owner,
    text: (await seal(w.userId, FIELD.taskTitle, p.text))!, due_on: dayIn(p.dueDays), status: "open",
  })));
  must("promises", await db.from("commitments").insert(rows));
}

/** Replies the worker has already sent today, which Your Day counts as Replied Today. */
async function seedSent(db: Admin, w: World) {
  const now = new Date().toISOString();
  const rows = await Promise.all(SENT_REPLIES.map(async (r, i) => ({
    user_id: w.userId, thread_id: w.threads[r.thread], account_id: w.accountId, body: (await seal(w.userId, FIELD.body, r.body))!, status: "sent",
    provider_message_id: `<seeded-sent-${i}@example.com>`, sent_at: now,
  })));
  must("sent replies", await db.from("outbox").insert(rows));
}

/** Writes everything beyond the messages themselves. `accounts` are the fake task and calendar accounts, which hold no sign-in. */
export async function seedExtras(db: Admin, w: World, accounts: { tasks: string; calendar: string }) {
  await seedAi(db, w);
  await seedLabels(db, w);
  await seedStates(db, w);
  await seedPlanner(db, w, accounts);
  await seedBriefAndPromises(db, w);
  await seedSent(db, w);
}
