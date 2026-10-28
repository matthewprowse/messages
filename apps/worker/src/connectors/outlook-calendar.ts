// Outlook Calendar through Microsoft Graph: the events in a window around today, for the briefing and for
// triage to know who you are meeting. Every few minutes the window is fetched again from every calendar and
// replaces what is stored, the same way as Google Calendar. Changing an event and answering an invitation from
// the app work when the sign-in has Calendars.ReadWrite; creating and deleting events is Google and iCloud only
// for now.

import type { TablesInsert } from "@messages/db";
import { Backoff, Sleeper } from "../backoff";
import { setAccountStatus, type AccountRow } from "../db";
import { errorCode, log } from "../log";
import { mapLimit } from "../util";
import { normAddresses } from "../send/from-address";
import { storeWindow } from "../calendar/store-window";
import { GraphApiError, signInRevoked, type GraphClient } from "../microsoft/client";
import { claimUpdate, failUpdate, settleUpdated, storeChange, storedEventOfUpdate } from "../calendar/update-queue";
import { GONE, GRAPH_RESPONSE, graphBody, graphUpdateFailure, readChange, type CalendarUpdateRow, type GraphGuest } from "../calendar/update-event";
import { CALENDAR_SCOPE } from "../microsoft/oauth";
import { microsoftFatalDetail, openGraphClient } from "../microsoft/session";
import { storedOutlookEvent, type GraphEvent } from "../microsoft/calendar-event";

const POLL_MS = 5 * 60_000;
const PAST_DAYS = 7;
const FUTURE_DAYS = 60;
const PAGE_SIZE = 200;
const CALENDARS_AT_ONCE = 2; // calendars read together (Graph allows four requests at once per mailbox)
/** The scope that lets the app change events. The sign-in asks only for Calendars.Read today, so until that is raised changes are refused. */
const WRITE_SCOPE = "Calendars.ReadWrite";
export const READ_ONLY = "Outlook Calendar is read only for now, so this event cannot be changed from here.";

const SELECT = "id,iCalUId,subject,isAllDay,isCancelled,start,end,location,attendees,organizer";

interface GraphCalendar {
  id: string;
  isDefaultCalendar?: boolean;
}

export class OutlookCalendarConnector {
  private stopped = false;
  private readonly sleeper = new Sleeper();
  private readonly backoff = new Backoff();
  private selfAddresses = new Set<string>();
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
    this.canWrite = creds.scopes.some((scope) => scope.toLowerCase() === WRITE_SCOPE.toLowerCase());
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

  /** Fetches the window from every calendar and replaces the stored copy. */
  private async sync(client: GraphClient) {
    const now = Date.now();
    const timeMin = new Date(now - PAST_DAYS * 86_400_000).toISOString();
    const timeMax = new Date(now + FUTURE_DAYS * 86_400_000).toISOString();

    const calendars: GraphCalendar[] = [];
    let next: string | undefined = "/me/calendars";
    let query: Record<string, string> | undefined = { $select: "id,isDefaultCalendar" };
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
          prefer: ['outlook.timezone="UTC"', `odata.maxpagesize=${PAGE_SIZE}`],
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
        const row = storedOutlookEvent(event, { userId: this.account.user_id, accountId: this.id, calendarId: calendars[i].id, selfAddresses: this.selfAddresses });
        if (!row || rows.has(row.provider_event_id)) continue;
        rows.set(row.provider_event_id, row);
        if (event.iCalUId) seen.add(event.iCalUId);
      }
    }

    // Anything stored for this window that Outlook no longer has was cancelled or moved out.
    const { written, removed } = await storeWindow(this.id, rows, { timeMin, timeMax });
    log.info("outlook calendar synced", { account: this.id, calendars: calendars.length, events: rows.size, written, removed });
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

    const url = `/me/events/${encodeURIComponent(event.provider_event_id)}`;
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
    await storeChange(event, change, false, null);
    await settleUpdated(row.id, change.scope === "series" ? "Only this event was changed. Changing every event in a series is not available for Outlook Calendar yet." : null);
    log.info("outlook calendar event changed", { account: this.id, event: row.id, kind: change.kind });
  }
}
