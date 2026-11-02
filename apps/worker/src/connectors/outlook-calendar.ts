// Outlook Calendar through Microsoft Graph: the events in a window around today, for the briefing and for
// triage to know who you are meeting. Every few minutes the window is fetched again from every calendar and
// replaces what is stored, the same way as Google Calendar. Creating, changing and deleting an event and answering
// an invitation from the app work when the sign-in has Calendars.ReadWrite, which the web page asks for later
// (incremental consent); until then each is refused with a message saying so.

import type { TablesInsert } from "@messages/db";
import { Backoff, Sleeper, supervise } from "../backoff";
import { db, setAccountStatus, type AccountRow } from "../db";
import { errorCode, log } from "../log";
import { mapLimit } from "../util";
import { normAddresses } from "../send/from-address";
import { storeWindow } from "../calendar/store-window";
import { fullFetchDue, syncWindow } from "../calendar/sync-window";
import { GraphApiError, signInRevoked, type GraphClient } from "../microsoft/client";
import { sealEvent } from "../calendar/sealed";
import { claimDelete, failDelete, settleDeleted, storedEventOf, type CalendarDeleteRow } from "../calendar/delete-event";
import type { CalendarOutboxRow } from "../calendar/create-event";
import { claimEvent, failEvent, settleCreated } from "./google-calendar";
import { claimUpdate, failUpdate, settleUpdated, storeChange, storedEventOfUpdate } from "../calendar/update-queue";
import { GONE, GRAPH_RESPONSE, graphBody, graphUpdateFailure, readChange, type CalendarUpdateRow, type GraphGuest } from "../calendar/update-event";
import { CALENDAR_SCOPE, CALENDAR_WRITE_SCOPE } from "../microsoft/oauth";
import { READ_BACK, WRITE_NOT_GRANTED, MAYBE_CREATED, buildGraphCreate, graphCreateFailure, graphDeleteFailure, targetId } from "../microsoft/calendar-write";
import { microsoftFatalDetail, openGraphClient } from "../microsoft/session";
import { storedOutlookEvent, type GraphEvent } from "../microsoft/calendar-event";

const POLL_MS = 5 * 60_000;
const PAGE_SIZE = 200;
const CALENDARS_AT_ONCE = 2; // calendars read together (Graph allows four requests at once per mailbox)
/** Said when the sign-in has only Calendars.Read: the web page can ask for the rest. */
export const READ_ONLY = WRITE_NOT_GRANTED;

const SELECT = "id,iCalUId,seriesMasterId,subject,isAllDay,isCancelled,start,end,location,attendees,organizer,body,onlineMeeting,onlineMeetingUrl";

interface GraphCalendar {
  id: string;
  name?: string;
  isDefaultCalendar?: boolean;
}

export class OutlookCalendarConnector {
  private stopped = false;
  private readonly sleeper = new Sleeper();
  private readonly backoff = new Backoff();
  private selfAddresses = new Set<string>();
  /** When the whole window was last fetched. Between those the near part alone is polled, as Graph has no cheap change check. */
  private lastFullAt: number | null = null;
  /** The signed-in client while a session is running; queued changes wait until there is one. */
  private client: GraphClient | null = null;
  private canWrite = false;
  /** Changes to events run one at a time, so two to the same event cannot cross. */
  private updates: Promise<void> = Promise.resolve();

  constructor(private readonly account: AccountRow) {}

  get id() {
    return this.account.id;
  }

  start() {
    void supervise(() => this.run(), () => this.stopped, (err) => log.error("outlook calendar run loop failed", { account: this.id, code: errorCode(err) }));
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
        const fatal = microsoftFatalDetail(err, "Calendar");
        if (fatal) {
          if (signInRevoked(err)) log.error("outlook calendar sign-in revoked", { account: this.id, code: errorCode(err) });
          await setAccountStatus(this.id, "error", fatal).catch(() => undefined);
          return;
        }
        log.warn("outlook calendar sync failed", { account: this.id, code: errorCode(err) });
        await setAccountStatus(this.id, "connecting", "Connection lost. Reconnecting.").catch(() => undefined);
      }
      if (this.stopped) break;
      await this.sleeper.wait(this.backoff.next());
    }
  }

  private async session() {
    await setAccountStatus(this.id, "connecting");
    const { client, creds } = await openGraphClient(this.id, [CALENDAR_SCOPE]);
    this.client = client;
    this.canWrite = creds.scopes.some((scope) => scope.toLowerCase() === CALENDAR_WRITE_SCOPE.toLowerCase());
    const me = await client.request<{ mail?: string | null; userPrincipalName?: string | null }>("/me", { query: { $select: "mail,userPrincipalName" } });
    this.selfAddresses = new Set(normAddresses([this.account.address, me.mail, me.userPrincipalName?.includes("@") ? me.userPrincipalName : null]));

    await setAccountStatus(this.id, "syncing");
    while (!this.stopped) {
      await this.sync(client);
      this.backoff.reset();
      await setAccountStatus(this.id, "connected");
      await this.sleeper.wait(POLL_MS);
    }
  }

  /**
   * Fetches the window from every calendar and replaces the stored copy. The whole window (90 days back, a year ahead)
   * is read hourly; the polls between read only the near part, so a five minute refresh stays small.
   */
  private async sync(client: GraphClient) {
    const now = Date.now();
    const full = fullFetchDue(now, this.lastFullAt);
    const { timeMin, timeMax } = syncWindow(now, full ? "full" : "near");

    const calendars: GraphCalendar[] = [];
    let next: string | undefined = "/me/calendars";
    let query: Record<string, string> | undefined = { $select: "id,name,isDefaultCalendar" };
    while (next) {
      const page: { value?: GraphCalendar[]; "@odata.nextLink"?: string } = await client.request(next, { query });
      calendars.push(...(page.value ?? []));
      next = page["@odata.nextLink"];
      query = undefined; // a next link carries its own
    }
    // The default calendar first, so an event on two calendars is filed under it.
    calendars.sort((a, b) => Number(!!b.isDefaultCalendar) - Number(!!a.isDefaultCalendar));

    const perCalendar = await mapLimit(calendars, CALENDARS_AT_ONCE, async (calendar) => {
      const events: GraphEvent[] = [];
      // calendarView expands repeating events into their individual occurrences, each with its own IDs.
      let url: string | undefined = `/me/calendars/${encodeURIComponent(calendar.id)}/calendarView`;
      let params: Record<string, string> | undefined = { startDateTime: timeMin, endDateTime: timeMax, $select: SELECT };
      while (url) {
        const page: { value?: GraphEvent[]; "@odata.nextLink"?: string } = await client.request(url, {
          query: params,
          prefer: ['outlook.timezone="UTC"', 'outlook.body-content-type="text"', `odata.maxpagesize=${PAGE_SIZE}`],
        });
        events.push(...(page.value ?? []));
        url = page["@odata.nextLink"];
        params = undefined;
      }
      return events;
    });
    // Merged in calendar order, so an event on two calendars is filed under the first one.
    const rows = new Map<string, TablesInsert<"calendar_events">>();
    const seen = new Set<string>(); // iCalUIds already stored: the same meeting on another calendar
    for (const [i, events] of perCalendar.entries()) {
      for (const event of events) {
        if (event.iCalUId && seen.has(event.iCalUId)) continue;
        const row = storedOutlookEvent(event, { userId: this.account.user_id, accountId: this.id, calendarId: calendars[i].id, calendarName: calendars[i].name ?? null, selfAddresses: this.selfAddresses });
        if (!row || rows.has(row.provider_event_id)) continue;
        rows.set(row.provider_event_id, row);
        if (event.iCalUId) seen.add(event.iCalUId);
      }
    }

    // Anything stored for this window that Outlook no longer has was cancelled or moved out.
    const { written, removed } = await storeWindow(this.id, rows, { timeMin, timeMax });
    if (full) this.lastFullAt = now;
    log.info("outlook calendar synced", { account: this.id, calendars: calendars.length, events: rows.size, written, removed, full });
  }

  /**
   * Creates a queued event with one POST, stores it with the synced events and settles the row. A request that may
   * have reached Outlook is never sent again (Graph also refuses a second POST with the same transactionId).
   */
  async createEvent(row: CalendarOutboxRow) {
    const client = this.client;
    if (!client || this.stopped) return; // still connecting: picked up on the next pass
    if (row.account_id !== this.id || row.user_id !== this.account.user_id) {
      await failEvent(row.id, "This event belongs to another account.");
      return;
    }
    if (!this.canWrite) {
      await failEvent(row.id, READ_ONLY);
      return;
    }
    const request = buildGraphCreate(row);
    if ("error" in request) {
      await failEvent(row.id, request.error);
      return;
    }
    if (!(await claimEvent(row.id))) return;

    let event: GraphEvent & { webLink?: string };
    try {
      event = await client.request<GraphEvent & { webLink?: string }>(request.url, { method: "POST", body: request.body, prefer: READ_BACK, timeoutMs: 30_000 });
    } catch (err) {
      log.warn("outlook calendar event not created", { account: this.id, event: row.id, code: errorCode(err) });
      await failEvent(row.id, err instanceof GraphApiError ? graphCreateFailure(err.status, err.graphCode) : MAYBE_CREATED);
      return;
    }

    if (event.id) {
      try {
        // The sync files events under a calendar's real id, so "primary" is looked up to match the next pass.
        const calendarId = row.calendar_id === "primary" ? ((await client.request<{ id?: string }>("/me/calendar", { query: { $select: "id" } })).id ?? row.calendar_id) : row.calendar_id;
        const stored = storedOutlookEvent(event, { userId: row.user_id, accountId: this.id, calendarId, selfAddresses: this.selfAddresses });
        if (stored) {
          const saved = await db.from("calendar_events").upsert(await sealEvent(stored.user_id, stored), { onConflict: "account_id,provider_event_id" });
          if (saved.error) log.warn("created event not stored", { account: this.id, event: row.id, code: saved.error.code });
        }
      } catch (err) {
        log.warn("created event not stored", { account: this.id, event: row.id, code: errorCode(err) });
      }
    }
    await settleCreated(row.id, event.id ?? row.id, event.webLink ?? null);
    log.info("outlook calendar event created", { account: this.id, event: row.id, attendees: row.attendees.length });
  }

  /**
   * Deletes an event (the whole series for a repeating event when asked to, else that occurrence), then removes the
   * stored copy. Outlook tells the guests itself. An event Outlook no longer has counts as deleted.
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
    if (!this.canWrite) {
      await failDelete(row.id, READ_ONLY);
      return;
    }
    if (!(await claimDelete(row.id))) return;

    try {
      await client.request(`/me/events/${encodeURIComponent(targetId(event, row.scope === "series"))}`, { method: "DELETE", timeoutMs: 30_000 });
    } catch (err) {
      const gone = err instanceof GraphApiError && err.status === 404;
      if (!gone) {
        log.warn("outlook calendar event not deleted", { account: this.id, event: row.id, code: errorCode(err) });
        await failDelete(row.id, graphDeleteFailure(err instanceof GraphApiError ? err.status : null, err instanceof GraphApiError ? err.graphCode : null));
        return;
      }
    }
    await settleDeleted(row, event);
    log.info("outlook calendar event deleted", { account: this.id, event: row.id, scope: row.scope });
  }

  /** Changes an event, or answers an invitation, as queued in calendar_updates. One at a time, in the order they arrive. */
  updateEvent(row: CalendarUpdateRow): Promise<void> {
    const run = this.updates.then(() => this.applyUpdate(row));
    this.updates = run.catch(() => undefined);
    return run;
  }

  /**
   * Changes an event with a PATCH, or answers it with accept, tentativelyAccept or decline, then stores the change.
   * Outlook tells guests of every change itself. A change to a whole series is applied to that occurrence, and the
   * row is settled with a note saying so, as the app does not keep a repeating Outlook event's series.
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
    if (!this.canWrite) {
      await failUpdate(row.id, READ_ONLY);
      return;
    }
    const change = readChange(row);
    if ("error" in change) {
      await failUpdate(row.id, change.error);
      return;
    }
    if (!(await claimUpdate(row.id))) return;

    // An answer, or a change that moves nothing in time, can go to the whole series by its master. A change of time
    // cannot: it is made to that occurrence, as the note says.
    const series = change.scope === "series" && !!event.series_id && (change.kind === "rsvp" || !change.time);
    const url = `/me/events/${encodeURIComponent(targetId(event, series))}`;
    try {
      if (change.kind === "rsvp") {
        await client.request(`${url}/${GRAPH_RESPONSE[change.response!]}`, { method: "POST", body: { sendResponse: change.sendInvites, comment: "" }, timeoutMs: 30_000 });
      } else {
        const current = change.attendees !== undefined ? ((await client.request<{ attendees?: GraphGuest[] }>(url, { query: { $select: "attendees" } })).attendees ?? []) : [];
        const built = graphBody(change, current);
        if ("error" in built) {
          await failUpdate(row.id, built.error);
          return;
        }
        await client.request(url, { method: "PATCH", body: built.body, timeoutMs: 30_000 });
      }
    } catch (err) {
      log.warn("outlook calendar event not changed", { account: this.id, event: row.id, code: errorCode(err) });
      if (err instanceof GraphApiError && err.status === 403 && err.graphCode === "ErrorAccessDenied") await failUpdate(row.id, READ_ONLY);
      else await failUpdate(row.id, graphUpdateFailure(err instanceof GraphApiError ? err.status : null));
      return;
    }
    await storeChange(event, change, series, null);
    await settleUpdated(row.id, change.scope === "series" && !series ? "Only this event was moved. Moving every event in a series is not available for Outlook Calendar yet." : null);
    log.info("outlook calendar event changed", { account: this.id, event: row.id, kind: change.kind, scope: series ? "series" : "occurrence" });
  }
}
