// Every two minutes, and once a minute after startup, ties the meetings the Teams, Zoom and Google Meet
// connectors store to the rest of the app. Those connectors only write meetings and meeting_participants;
// this finds, for meetings from the last LOOKBACK_DAYS:
//   - each participant's contact, by their email address's blind index, as calendar guests are found;
//   - each meeting's calendar event, by join link and then by time and shared guests (match.ts).
// A meeting whose people were just matched is touched, so the app (subscribed to meetings over Realtime)
// shows it in their conversations at once. Something not matched is tried again after RETRY_MS: the
// person may become a contact, or the event may sync, later.

import { addressIndex } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import { startEvery } from "../backoff";
import { allRows, db, must } from "../db";
import { errorCode, log } from "../log";
import { chunks, mapLimit, push } from "../util";
import { keysFor, open } from "../vault";
import { eventEmails, LINK_WINDOW_MS, matchEvent, participantEmail } from "./match";

const FIRST_RUN_MS = 60_000;
const EVERY_MS = 2 * 60_000;
const LOOKBACK_DAYS = 90;
const RETRY_MS = 30 * 60_000;
const MAX_ROWS = 5000; // per kind per run, a safety stop: the rest wait for the next run
const EVENTS_AT_ONCE = 4;

/** Participants and meetings looked at without a match, and when, so they wait RETRY_MS before the next look. */
const tried = new Map<string, number>();

let started = false;

export function startMeetingLinker() {
  if (started) return;
  started = true;
  startEvery(FIRST_RUN_MS, EVERY_MS, runMeetingLinker, (err) => log.warn("meeting linker failed", { code: errorCode(err) }));
}

const due = (id: string, now: number) => (tried.get(id) ?? 0) + RETRY_MS <= now;

async function runMeetingLinker() {
  const now = Date.now();
  for (const [id, at] of tried) if (at + RETRY_MS <= now) tried.delete(id);
  const since = new Date(now - LOOKBACK_DAYS * 24 * 3_600_000).toISOString();
  const people = await linkParticipants(since, now);
  const events = await linkEvents(since, now);
  if (people.linked || events.linked) log.info("meetings linked", { participants: people.linked, events: events.linked, touched: people.touched });
}

/** Participants not yet tied to a contact, matched by the index of their email address. */
async function linkParticipants(since: string, now: number): Promise<{ linked: number; touched: number }> {
  const rows = await allRows(
    (f, t) =>
      db
        .from("meeting_participants")
        .select("id, user_id, meeting_id, address, meetings!inner(started_at)")
        .is("contact_id", null)
        .eq("is_self", false)
        .not("address", "is", null)
        .gte("meetings.started_at", since)
        .order("id")
        .range(f, t),
    "load unmatched meeting participants",
    MAX_ROWS,
  );
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) if (due(r.id, now)) push(byUser, r.user_id, r);

  let linked = 0;
  const touched = new Set<string>();
  for (const [user, list] of byUser) {
    try {
      const keys = await keysFor(user);
      const indexed = await Promise.all(
        list.map(async (r) => {
          const email = participantEmail(await open(user, FIELD.address, r.address));
          return { row: r, idx: email ? await addressIndex(keys, email) : null };
        }),
      );
      const indexes = [...new Set(indexed.flatMap((i) => (i.idx ? [i.idx] : [])))];
      const contactOf = new Map<string, string>();
      for (const batch of chunks(indexes, 200)) {
        const found = must(
          await db.from("contact_identities").select("contact_id, value_index").eq("user_id", user).eq("kind", "email").in("value_index", batch),
          "load contacts for meeting participants",
        );
        for (const f of found) if (f.value_index && !contactOf.has(f.value_index)) contactOf.set(f.value_index, f.contact_id);
      }
      const toContact = new Map<string, string[]>();
      for (const { row, idx } of indexed) {
        const contact = idx ? contactOf.get(idx) : undefined;
        if (contact) push(toContact, contact, row.id);
        else tried.set(row.id, now);
      }
      for (const [contact, ids] of toContact) {
        for (const batch of chunks(ids, 200)) {
          const saved = must(
            await db.from("meeting_participants").update({ contact_id: contact }).eq("user_id", user).in("id", batch).is("contact_id", null).select("meeting_id"),
            "link meeting participants",
          );
          linked += saved.length;
          for (const s of saved) touched.add(s.meeting_id);
        }
      }
    } catch (err) {
      log.warn("meeting participants not linked", { user, code: errorCode(err) });
    }
  }
  // An update that changes nothing still reaches Realtime, and set_updated_at stamps it.
  for (const batch of chunks([...touched], 200)) {
    const { error } = await db.from("meetings").update({ updated_at: new Date().toISOString() }).in("id", batch);
    if (error) log.warn("linked meetings not touched", { code: error.code });
  }
  return { linked, touched: touched.size };
}

/** Meetings not yet tied to a calendar event, matched to one of that user's events around the same time. */
async function linkEvents(since: string, now: number): Promise<{ linked: number }> {
  const meetings = (
    await allRows(
      (f, t) =>
        db
          .from("meetings")
          .select("id, user_id, started_at, ended_at, provider_meta")
          .is("calendar_event_id", null)
          .gte("started_at", since)
          .order("id")
          .range(f, t),
      "load unmatched meetings",
      MAX_ROWS,
    )
  ).filter((m) => due(m.id, now));
  if (!meetings.length) return { linked: 0 };

  // Everyone in each meeting except you, by email address.
  const emailsOf = new Map<string, string[]>();
  for (const ids of chunks(meetings.map((m) => m.id), 100)) {
    const rows = must(await db.from("meeting_participants").select("meeting_id, user_id, address").in("meeting_id", ids).eq("is_self", false), "load meeting participants");
    for (const r of rows) {
      const email = participantEmail(await open(r.user_id, FIELD.address, r.address));
      if (email) push(emailsOf, r.meeting_id, email);
    }
  }

  let linked = 0;
  await mapLimit(meetings, EVENTS_AT_ONCE, async (m) => {
    try {
      const start = Date.parse(m.started_at);
      const events = must(
        await db
          .from("calendar_events")
          .select("id, starts_at, ends_at, all_day, conference_url, attendees")
          .eq("user_id", m.user_id)
          .gte("starts_at", new Date(start - LINK_WINDOW_MS).toISOString())
          .lte("starts_at", new Date(start + LINK_WINDOW_MS).toISOString())
          .order("starts_at")
          .limit(500),
        "load events for a meeting",
      );
      const meta = (m.provider_meta ?? {}) as { join_url?: unknown };
      const id = matchEvent(
        { startedAt: m.started_at, endedAt: m.ended_at, joinUrl: typeof meta.join_url === "string" ? meta.join_url : null, emails: emailsOf.get(m.id) ?? [] },
        events.map((e) => ({ id: e.id, startsAt: e.starts_at, endsAt: e.ends_at, allDay: e.all_day, conferenceUrl: e.conference_url, emails: eventEmails(e.attendees) })),
      );
      if (!id) {
        tried.set(m.id, now);
        return;
      }
      must(await db.from("meetings").update({ calendar_event_id: id }).eq("id", m.id).is("calendar_event_id", null), "link meeting to event");
      linked++;
    } catch (err) {
      log.warn("meeting not linked to an event", { meeting: m.id, code: errorCode(err) });
    }
  });
  return { linked };
}
