import type { TablesInsert } from "@messages/db";
import { Backoff, Sleeper } from "../backoff";
import { db, must, retryWrite, setAccountStatus, type AccountRow } from "../db";
import { errorCode, log } from "../log";
import { mapLimit } from "../util";
import { GoogleApiError, signInRevoked, type GoogleClient } from "../google/client";
import { CALENDAR_EVENTS_SCOPE, CALENDAR_SCOPE, GoogleAuthError } from "../google/oauth";
import { googleFatalDetail, openGoogleClient } from "../google/session";
import { storeWindow } from "../calendar/store-window";
import { DELETE_NOT_GRANTED, GONE, claimDelete, failDelete, settleDeleted, storedEventOf, type CalendarDeleteRow } from "../calendar/delete-event";
import { claimUpdate, failUpdate, settleUpdated, storeChange, storedEventOfUpdate } from "../calendar/update-queue";
import { UPDATE_NOT_GRANTED, googleBody, googleNeedsRead, googleUpdateFailure, readChange, seriesShift, type CalendarUpdateRow, type SeriesShift } from "../calendar/update-event";
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
const CALENDARS_AT_ONCE = 3; // calendars read together
const FULL_EVERY_MS = 60 * 60_000; // full fetch at least hourly, even when nothing changed

interface CalendarListEntry {
  id: string;
  summary?: string;
  /** The name this account gave the calendar, which is what Google Calendar shows. */
  summaryOverride?: string;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
  deleted?: boolean;
}

const SIGN_IN_EXPIRED = "Google sign-in expired or was removed. Reconnect Google in Settings, Connected Accounts.";
const NOT_RECORDED = "The event was created, but could not be recorded. Check Google Calendar before trying again.";

// The calendar_outbox table: the app adds queued events, the worker claims, creates and settles them.

/** Marks a queued event as creating. Returns false if another run already took it. */
export async function claimEvent(id: string): Promise<boolean> {
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
export async function settleCreated(id: string, providerEventId: string, htmlLink: string | null) {
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
  /** Changes to events run one at a time, so two to the same event cannot cross. */
  private updates: Promise<void> = Promise.resolve();

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
      const probes = await mapLimit(shown, CALENDARS_AT_ONCE, (c) =>
        client.request<{ items?: unknown[] }>(`${API}/calendars/${encodeURIComponent(c.id)}/events`, {
          query: { updatedMin: since, showDeleted: true, singleEvents: true, maxResults: 1 },
        }),
      );
      if (probes.every((p) => !p.items?.length)) return;
    }

    const rows = new Map<string, TablesInsert<"calendar_events">>();
    const perCalendar = await mapLimit(shown, CALENDARS_AT_ONCE, async (calendar) => {
      const found: TablesInsert<"calendar_events">[] = [];
      let token: string | undefined;
      do {
        const page: { items?: GoogleEvent[]; nextPageToken?: string } = await client.request(
          `${API}/calendars/${encodeURIComponent(calendar.id)}/events`,
          // singleEvents expands repeating events into their individual occurrences.
          { query: { timeMin, timeMax, singleEvents: true, showDeleted: false, maxResults: 2500, pageToken: token } },
        );
        for (const event of page.items ?? []) {
          const row = storedEvent(event, { userId: this.account.user_id, accountId: this.id, calendarId: calendar.id, calendarName: calendar.summaryOverride ?? calendar.summary ?? null });
          if (row) found.push(row);
        }
        token = page.nextPageToken;
      } while (token);
      return found;
    });
    // Merged in calendar order, so a shared event stays filed under the first calendar that has it (the primary).
    for (const found of perCalendar) for (const row of found) if (!rows.has(row.provider_event_id)) rows.set(row.provider_event_id, row);

    // Anything stored for this window that Google no longer has was cancelled, moved out or hidden.
    const { written, removed } = await storeWindow(this.id, rows, { timeMin, timeMax });
    this.lastFetch = { startedAt, at: now, calendars: calendarKey };
    log.info("calendar synced", { account: this.id, calendars: shown.length, events: rows.size, written, removed });
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

  /**
   * Deletes an event from Google Calendar (the whole series for a repeating event when asked to, else that
   * occurrence), telling its guests, then removes the stored copy. An event Google no longer has counts as deleted.
   */
  async deleteEvent(row: CalendarDeleteRow) {
    const client = this.client;
    if (!client || this.stopped) return; // still connecting: picked up on the next pass
    if (row.account_id !== this.id || row.user_id !== this.account.user_id) {
      await failDelete(row.id, "This event belongs to another account.");
      return;
    }
    const event = await storedEventOf(row);
    if (!event) {
      await failDelete(row.id, GONE);
      return;
    }
    if (!this.canCreate) {
      await failDelete(row.id, DELETE_NOT_GRANTED);
      return;
    }
    if (!(await claimDelete(row.id))) return;

    const target = row.scope === "series" && event.series_id ? event.series_id : event.provider_event_id;
    try {
      await client.request(`${API}/calendars/${encodeURIComponent(event.calendar_id)}/events/${encodeURIComponent(target)}`, {
        method: "DELETE",
        query: { sendUpdates: "all" },
        timeoutMs: 30_000,
      });
    } catch (err) {
      const gone = err instanceof GoogleApiError && (err.status === 404 || err.status === 410);
      if (!gone) {
        log.warn("calendar event not deleted", { account: this.id, event: row.id, code: errorCode(err) });
        await failDelete(row.id, err instanceof GoogleAuthError ? SIGN_IN_EXPIRED : deleteFailure(err instanceof GoogleApiError ? err : null));
        return;
      }
    }
    await settleDeleted(row, event);
    log.info("calendar event deleted", { account: this.id, event: row.id, scope: row.scope });
  }

  /** Changes an event, or answers an invitation, as queued in calendar_updates. One at a time, in the order they arrive. */
  updateEvent(row: CalendarUpdateRow): Promise<void> {
    const run = this.updates.then(() => this.applyUpdate(row));
    this.updates = run.catch(() => undefined);
    return run;
  }

  /**
   * Changes an event in Google Calendar with events.patch, telling its guests when asked to, then stores the
   * change with the synced events. For a repeating event the whole series is changed when that is what was asked
   * for, else that occurrence. Your answer to an invitation is your own entry in the guest list.
   */
  private async applyUpdate(row: CalendarUpdateRow) {
    const client = this.client;
    if (!client || this.stopped) return; // still connecting: picked up on the next pass
    if (row.account_id !== this.id || row.user_id !== this.account.user_id) {
      await failUpdate(row.id, "This event belongs to another account.");
      return;
    }
    const event = await storedEventOfUpdate(row);
    if (!event) {
      await failUpdate(row.id, GONE);
      return;
    }
    if (!this.canCreate) {
      await failUpdate(row.id, UPDATE_NOT_GRANTED);
      return;
    }
    const change = readChange(row);
    if ("error" in change) {
      await failUpdate(row.id, change.error);
      return;
    }
    const series = change.scope === "series" && !!event.series_id;
    let shift: SeriesShift | null = null;
    if (series && change.time) {
      const found = seriesShift(change.time, event);
      if ("error" in found) {
        await failUpdate(row.id, found.error);
        return;
      }
      shift = found;
    }
    if (!(await claimUpdate(row.id))) return;

    const url = `${API}/calendars/${encodeURIComponent(event.calendar_id)}/events/${encodeURIComponent(series ? event.series_id! : event.provider_event_id)}`;
    try {
      const current = googleNeedsRead(change, series) ? await client.request<GoogleEvent>(url, { query: { fields: "attendees,start,end" }, timeoutMs: 30_000 }) : null;
      const built = googleBody(change, current, shift);
      if ("error" in built) {
        await failUpdate(row.id, built.error);
        return;
      }
      await client.request<GoogleEvent>(url, { method: "PATCH", query: { sendUpdates: change.sendInvites ? "all" : "none" }, body: built.body, timeoutMs: 30_000 });
    } catch (err) {
      log.warn("calendar event not changed", { account: this.id, event: row.id, code: errorCode(err) });
      if (err instanceof GoogleAuthError) await failUpdate(row.id, SIGN_IN_EXPIRED);
      else await failUpdate(row.id, googleUpdateFailure(err instanceof GoogleApiError ? err.status : null, err instanceof GoogleApiError ? err.reason : null));
      return;
    }
    await storeChange(event, change, series, shift);
    await settleUpdated(row.id);
    log.info("calendar event changed", { account: this.id, event: row.id, kind: change.kind, scope: series ? "series" : "occurrence" });
  }
}

/** What a refused delete means. */
function deleteFailure(err: GoogleApiError | null): string {
  if (err?.status === 403 && err.reason === "insufficientPermissions") return DELETE_NOT_GRANTED;
  if (err?.status === 403 && err.reason && /rate|quota/i.test(err.reason)) return "Google Calendar is busy. Try again in a minute.";
  if (err?.status === 429) return "Google Calendar is busy. Try again in a minute.";
  if (err?.status === 403) return "You cannot delete events from this calendar.";
  return "Google Calendar did not delete this event. Try again.";
}
