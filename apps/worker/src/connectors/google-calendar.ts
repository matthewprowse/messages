import type { TablesInsert } from "@messages/db";
import { Backoff, Sleeper } from "../backoff";
import { allRows, db, must, retryWrite, setAccountStatus, type AccountRow } from "../db";
import { errorCode, log } from "../log";
import { chunks } from "../util";
import { GoogleApiError, signInRevoked, type GoogleClient } from "../google/client";
import { CALENDAR_EVENTS_SCOPE, CALENDAR_SCOPE, GoogleAuthError } from "../google/oauth";
import { googleFatalDetail, openGoogleClient } from "../google/session";
import { eventChanged, type StoredEvent } from "../calendar/sync-diff";
import {
  API,
  EVENTS_NOT_GRANTED,
  MAYBE_CREATED,
  buildCreateEvent,
  createFailure,
  createdCalendarId,
  storedEvent,
  type CalendarOutboxRow,
  type GoogleEvent,
} from "../calendar/create-event";

// Google Calendar: the events in a window around today, for the briefing and for triage to know who
// you are meeting. Every few minutes the window is fetched again and replaces what is stored, which
// keeps moved and cancelled events right without Google's push channels or sync tokens. It also
// creates the events queued in calendar_outbox from the app.

const POLL_MS = 5 * 60_000;
const PAST_DAYS = 7;
const FUTURE_DAYS = 60;
const FULL_EVERY_MS = 60 * 60_000; // full fetch at least hourly, even when nothing changed

interface CalendarListEntry {
  id: string;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
  deleted?: boolean;
}

const SIGN_IN_EXPIRED = "Google sign-in expired or was removed. Run pnpm connect:google to reconnect.";
const NOT_RECORDED = "The event was created, but could not be recorded. Check Google Calendar before trying again.";

// The calendar_outbox table: the app adds queued events, the worker claims, creates and settles them.

/** Marks a queued event as creating. Returns false if another run already took it. */
async function claimEvent(id: string): Promise<boolean> {
  const rows = must(
    await db.from("calendar_outbox").update({ status: "creating" }).eq("id", id).eq("status", "queued").select("id"),
    "claim calendar event",
  );
  return rows.length === 1;
}

export async function failEvent(id: string, reason: string) {
  must(
    await db
      .from("calendar_outbox")
      .update({ status: "failed", error: reason, done_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", ["queued", "creating"]),
    "fail calendar event",
  );
}

/** Puts a claimed event back in the queue. Only for one that never reached Google Calendar. */
async function requeueEvent(id: string) {
  must(await db.from("calendar_outbox").update({ status: "queued" }).eq("id", id).eq("status", "creating"), "requeue calendar event");
}

/**
 * Records an event Google already created. Kept apart from the create itself: a failed database write
 * must not leave the row looking unsent, or the event is made twice.
 */
async function settleCreated(id: string, providerEventId: string, htmlLink: string | null) {
  const saved = await retryWrite(() =>
    db
      .from("calendar_outbox")
      .update({ status: "created", provider_event_id: providerEventId, html_link: htmlLink, error: null, done_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "creating"),
  );
  if (!saved) await failEvent(id, NOT_RECORDED).catch(() => undefined);
}

export async function queuedEvents(): Promise<CalendarOutboxRow[]> {
  return must(await db.from("calendar_outbox").select("*").eq("status", "queued").order("created_at").limit(50), "load calendar outbox");
}

/**
 * An event left in "creating" by a worker that stopped mid-request may or may not exist in Google
 * Calendar. It is failed rather than tried again, so nobody gets the same invite twice.
 */
export async function failInterruptedEvents() {
  must(
    await db.from("calendar_outbox").update({ status: "failed", error: MAYBE_CREATED, done_at: new Date().toISOString() }).eq("status", "creating"),
    "fail interrupted events",
  );
}

export class GoogleCalendarConnector {
  /** When the last full fetch started and which calendars it covered, for the cheap "anything changed?" check. */
  private lastFetch: { startedAt: string; at: number; calendars: string } | null = null;
  private stopped = false;
  private readonly sleeper = new Sleeper();
  private readonly backoff = new Backoff();
  /** The signed-in client while a session is running; queued events wait until there is one. */
  private client: GoogleClient | null = null;
  /** Whether the sign-in allows creating events (calendar.events). */
  private canCreate = false;

  constructor(private readonly account: AccountRow) {}

  get id() {
    return this.account.id;
  }

  start() {
    void this.run();
  }

  async stop() {
    this.stopped = true;
    this.sleeper.interrupt();
  }

  private async run() {
    while (!this.stopped) {
      try {
        await this.session();
      } catch (err) {
        if (this.stopped) break;
        const fatal = googleFatalDetail(err, "Calendar");
        if (fatal) {
          if (signInRevoked(err)) log.error("calendar sign-in revoked", { account: this.id, code: errorCode(err) });
          await setAccountStatus(this.id, "error", fatal);
          return;
        }
        log.warn("calendar sync failed", { account: this.id, code: errorCode(err) });
        await setAccountStatus(this.id, "connecting", "Connection lost. Reconnecting.").catch(() => undefined);
      }
      if (this.stopped) break;
      await this.sleeper.wait(this.backoff.next());
    }
  }

  private async session() {
    await setAccountStatus(this.id, "connecting");
    const { client, creds } = await openGoogleClient(this.id, CALENDAR_SCOPE);
    this.client = client;
    this.canCreate = creds.scopes.includes(CALENDAR_EVENTS_SCOPE);

    await setAccountStatus(this.id, "syncing");
    while (!this.stopped) {
      await this.sync(client);
      this.backoff.reset();
      await setAccountStatus(this.id, "connected");
      await this.sleeper.wait(POLL_MS);
    }
  }

  /** Fetches the window from every calendar shown in Google Calendar and replaces the stored copy. */
  private async sync(client: GoogleClient) {
    const now = Date.now();
    const timeMin = new Date(now - PAST_DAYS * 86_400_000).toISOString();
    const timeMax = new Date(now + FUTURE_DAYS * 86_400_000).toISOString();

    const calendars: CalendarListEntry[] = [];
    let pageToken: string | undefined;
    do {
      const page = await client.request<{ items?: CalendarListEntry[]; nextPageToken?: string }>(`${API}/users/me/calendarList`, {
        query: { minAccessRole: "reader", pageToken },
      });
      calendars.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    // The ones ticked in Google Calendar's sidebar, primary first so a shared event is filed under it.
    const shown = calendars.filter((c) => c.primary || (c.selected && !c.hidden && !c.deleted)).sort((a, b) => Number(!!b.primary) - Number(!!a.primary));

    // Cheap check first: one tiny request per calendar asks whether anything changed since the last fetch.
    // A full fetch still runs at least hourly, so events entering the window's far end appear.
    const calendarKey = shown.map((c) => c.id).join("|");
    const startedAt = new Date(now).toISOString();
    if (this.lastFetch && this.lastFetch.calendars === calendarKey && now - this.lastFetch.at < FULL_EVERY_MS) {
      const since = this.lastFetch.startedAt;
      const probes = await Promise.all(
        shown.map((c) =>
          client.request<{ items?: unknown[] }>(`${API}/calendars/${encodeURIComponent(c.id)}/events`, {
            query: { updatedMin: since, showDeleted: true, singleEvents: true, maxResults: 1 },
          }),
        ),
      );
      if (probes.every((p) => !p.items?.length)) return;
    }

    const rows = new Map<string, TablesInsert<"calendar_events">>();
    for (const calendar of shown) {
      pageToken = undefined;
      do {
        const page: { items?: GoogleEvent[]; nextPageToken?: string } = await client.request(
          `${API}/calendars/${encodeURIComponent(calendar.id)}/events`,
          // singleEvents expands repeating events into their individual occurrences.
          { query: { timeMin, timeMax, singleEvents: true, showDeleted: false, maxResults: 2500, pageToken } },
        );
        for (const event of page.items ?? []) {
          const row = storedEvent(event, { userId: this.account.user_id, accountId: this.id, calendarId: calendar.id });
          if (row && !rows.has(row.provider_event_id)) rows.set(row.provider_event_id, row);
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    }

    // The stored copy, every page of it: a window can hold more than the 1,000 rows one request returns.
    const stored: (StoredEvent & { id: string })[] = await allRows(
      (from, to) =>
        db
          .from("calendar_events")
          .select("id, provider_event_id, calendar_id, title, starts_at, ends_at, all_day, location, attendees")
          .eq("account_id", this.id)
          .order("id")
          .range(from, to),
      "load stored events",
    );
    const byEventId = new Map(stored.map((e) => [e.provider_event_id, e]));

    // Only new or changed events are written, so an unchanged calendar costs no writes.
    const changed = [...rows.values()].filter((row) => eventChanged(byEventId.get(row.provider_event_id), row));
    for (const batch of chunks(changed, 500)) {
      must(await db.from("calendar_events").upsert(batch, { onConflict: "account_id,provider_event_id" }), "save calendar events");
    }

    // Anything stored for this window that Google no longer has was cancelled, moved out or hidden.
    const min = Date.parse(timeMin);
    const max = Date.parse(timeMax);
    const stale = stored
      .filter((e) => !rows.has(e.provider_event_id))
      .filter((e) => {
        const t = Date.parse(e.starts_at);
        return t >= min && t < max;
      })
      .map((e) => e.id);
    for (const batch of chunks(stale, 200)) must(await db.from("calendar_events").delete().in("id", batch), "remove stale events");
    this.lastFetch = { startedAt, at: now, calendars: calendarKey };
    log.info("calendar synced", { account: this.id, calendars: shown.length, events: rows.size, written: changed.length, removed: stale.length });
  }

  /**
   * Creates a queued event in Google Calendar, stores it with the synced events and settles the row.
   * A request that may have reached Google is never sent again: its row fails with a warning instead.
   */
  async createEvent(row: CalendarOutboxRow) {
    const client = this.client;
    if (!client || this.stopped) return; // still connecting: picked up on the next pass
    if (row.account_id !== this.id || row.user_id !== this.account.user_id) {
      await failEvent(row.id, "This event belongs to another account.");
      return;
    }
    if (!this.canCreate) {
      await failEvent(row.id, EVENTS_NOT_GRANTED);
      return;
    }
    const request = buildCreateEvent(row);
    if ("error" in request) {
      await failEvent(row.id, request.error);
      return;
    }
    if (!(await claimEvent(row.id))) return;

    let event: GoogleEvent;
    try {
      event = await client.request<GoogleEvent>(request.url, { method: "POST", query: request.query, body: request.body, timeoutMs: 30_000 });
    } catch (err) {
      log.warn("calendar event not created", { account: this.id, event: row.id, code: errorCode(err) });
      if (err instanceof GoogleAuthError) {
        // The sign-in failed before the request was sent, so Google Calendar never saw it.
        if (signInRevoked(err)) await failEvent(row.id, SIGN_IN_EXPIRED);
        else await requeueEvent(row.id);
        return;
      }
      await failEvent(row.id, err instanceof GoogleApiError ? createFailure(err.status, err.reason) : MAYBE_CREATED);
      return;
    }

    const providerEventId = event.id ?? request.body.id!;
    const stored = storedEvent({ ...event, id: providerEventId }, { userId: row.user_id, accountId: this.id, calendarId: createdCalendarId(row, event) });
    if (stored) {
      // Shown in the app at once. If this write fails, the next sync stores it.
      const saved = await db.from("calendar_events").upsert(stored, { onConflict: "account_id,provider_event_id" });
      if (saved.error) log.warn("created event not stored", { account: this.id, event: row.id, code: saved.error.code });
    }
    await settleCreated(row.id, providerEventId, event.htmlLink ?? null);
    log.info("calendar event created", { account: this.id, event: row.id, attendees: request.body.attendees?.length ?? 0, meet: row.add_meet });
  }
}
