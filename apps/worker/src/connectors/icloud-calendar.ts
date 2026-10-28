// iCloud Calendar over CalDAV: the events in a window around today, for the briefing and for triage to
// know who you are meeting. Every few minutes the window is fetched again from every calendar and replaces
// what is stored, the same way as Google Calendar. It also creates the events queued in calendar_outbox
// from the app, deletes the ones queued in calendar_deletes and changes the ones queued in calendar_updates;
// nothing else is ever changed.

import type { TablesInsert } from "@messages/db";
import { Backoff, Sleeper, supervise } from "../backoff";
import { db, loadCredentials, setAccountStatus, type AccountRow } from "../db";
import { errorCode, log } from "../log";
import { mapLimit } from "../util";
import { normAddresses } from "../send/from-address";
import { sealEvent } from "../calendar/sealed";
import { storeWindow } from "../calendar/store-window";
import { basicAuth, calendarHome, deleteEventFile, eventUrl, eventsIn, getEvent, listCalendars, putEvent, replaceEvent, signInRejected, userAddresses, type DavCalendar } from "../caldav/client";
import { excludeOccurrence } from "../caldav/delete-event";
import { claimDelete, failDelete, GONE, settleDeleted, storedEventOf, type CalendarDeleteRow } from "../calendar/delete-event";
import { parseEvents, storedIcsEvent } from "../caldav/ical";
import { buildIcs, createFailure, MAYBE_CREATED, SIGN_IN_REJECTED } from "../caldav/create-event";
import type { CalendarOutboxRow } from "../calendar/create-event";
import { claimUpdate, failUpdate, settleUpdated, storeChange, storedEventOfUpdate } from "../calendar/update-queue";
import { readChange, seriesShift, GONE as EVENT_GONE, type CalendarUpdateRow, type SeriesShift } from "../calendar/update-event";
import { icloudUpdateFailure, occurrenceOf, updateIcs } from "../caldav/update-event";
import { SERIES_RULE } from "../calendar/recurrence";
import { claimEvent, failEvent, settleCreated } from "./google-calendar";
import type { ICloudCredentials } from "./icloud";

const POLL_MS = 5 * 60_000;
const PAST_DAYS = 7;
const FUTURE_DAYS = 60;
const CALENDARS_AT_ONCE = 2; // calendars read together
const SERIES_AT_ONCE = 3; // series files read together for their rules
const FULL_EVERY_MS = 60 * 60_000; // full fetch at least hourly, even when nothing changed

export class ICloudCalendarConnector {
  private stopped = false;
  private readonly sleeper = new Sleeper();
  private readonly backoff = new Backoff();
  private selfAddresses = new Set<string>();
  /** The calendars and their change markers at the last full fetch. */
  private lastFetch: { at: number; ctags: string } | null = null;
  /** How each series repeats, by its file, read from the file at most once per full fetch interval. */
  private readonly rules = new Map<string, { rule: string | null; at: number }>();
  /** The signed-in header and calendars while a session is running; queued events wait until there are some. */
  private live: { auth: string; calendars: DavCalendar[]; addresses: string[] | null } | null = null;
  /** Changes to events run one at a time, so two to the same event cannot cross. */
  private updates: Promise<void> = Promise.resolve();

  constructor(private readonly account: AccountRow) {}

  get id() {
    return this.account.id;
  }

  start() {
    void supervise(() => this.run(), () => this.stopped, (err) => log.error("icloud calendar run loop failed", { account: this.id, code: errorCode(err) }));
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
        if (signInRejected(err)) {
          log.error("icloud calendar sign-in rejected", { account: this.id, code: errorCode(err) });
          await setAccountStatus(this.id, "error", SIGN_IN_REJECTED).catch(() => undefined);
          return;
        }
        log.warn("icloud calendar sync failed", { account: this.id, code: errorCode(err) });
        await setAccountStatus(this.id, "connecting", "Connection lost. Reconnecting.").catch(() => undefined);
      }
      if (this.stopped) break;
      await this.sleeper.wait(this.backoff.next());
    }
  }

  private async session() {
    await setAccountStatus(this.id, "connecting");
    const creds = await loadCredentials<ICloudCredentials>(this.id);
    const auth = basicAuth(creds.username, creds.password);
    this.selfAddresses = new Set(normAddresses([this.account.address, creds.username, ...(creds.aliases ?? [])]));
    this.lastFetch = null;
    this.live = null;

    const home = await calendarHome(auth);
    await setAccountStatus(this.id, "syncing");
    while (!this.stopped) {
      await this.sync(auth, home);
      this.backoff.reset();
      await setAccountStatus(this.id, "connected");
      await this.sleeper.wait(POLL_MS);
    }
  }

  /** Fetches the window from every calendar and replaces the stored copy. */
  private async sync(auth: string, home: string) {
    const now = Date.now();
    const timeMin = new Date(now - PAST_DAYS * 86_400_000).toISOString();
    const timeMax = new Date(now + FUTURE_DAYS * 86_400_000).toISOString();

    // The default calendar is listed first by iCloud, so a meeting on two calendars is filed under it.
    const calendars: DavCalendar[] = await listCalendars(auth, home);
    this.live = { auth, calendars, addresses: this.live?.addresses ?? null };

    // Cheap check first: the listing says whether any calendar changed since the last fetch. A full fetch
    // still runs at least hourly, so events entering the window's far end appear.
    const ctags = calendars.map((c) => `${c.url} ${c.ctag ?? ""}`).join("|");
    if (this.lastFetch && this.lastFetch.ctags === ctags && !calendars.some((c) => !c.ctag) && now - this.lastFetch.at < FULL_EVERY_MS) return;

    const files = await mapLimit(calendars, CALENDARS_AT_ONCE, (calendar) => eventsIn(auth, calendar.url, { timeMin, timeMax }));
    // Merged in calendar order, so a meeting on two calendars is filed under the first one.
    const rows = new Map<string, TablesInsert<"calendar_events">>();
    for (const [i, calendar] of calendars.entries()) {
      for (const file of files[i]) {
        for (const event of parseEvents(file.ics)) {
          const row = storedIcsEvent(event, { userId: this.account.user_id, accountId: this.id, calendarId: calendar.url, calendarName: calendar.name, resourceUrl: file.url, selfAddresses: this.selfAddresses });
          if (row && !rows.has(row.provider_event_id)) rows.set(row.provider_event_id, row);
        }
      }
    }

    await this.addRules(auth, rows, now);

    // Anything stored for this window that iCloud no longer has was cancelled, moved out or deleted.
    const { written, removed } = await storeWindow(this.id, rows, { timeMin, timeMax });
    this.lastFetch = { at: now, ctags };
    log.info("icloud calendar synced", { account: this.id, calendars: calendars.length, events: rows.size, written, removed });
  }

  /**
   * Gives each occurrence of a repeating event its series' rule. iCloud sends occurrences already expanded, without
   * the rule, so the series' file is read for it, once per full fetch interval; one that cannot be read keeps what it
   * had.
   */
  private async addRules(auth: string, rows: Map<string, TablesInsert<"calendar_events">>, now: number) {
    const due = new Set<string>();
    for (const row of rows.values()) {
      const seen = row.resource_url ? this.rules.get(row.resource_url) : undefined;
      if (row.series_id && row.resource_url && (!seen || now - seen.at > FULL_EVERY_MS)) due.add(row.resource_url);
    }
    await mapLimit([...due], SERIES_AT_ONCE, async (url) => {
      try {
        const file = await getEvent(auth, url);
        const series = parseEvents(file.ics).find((e) => !e.recurrenceId);
        this.rules.set(url, { rule: series?.rrule ?? null, at: now });
      } catch (err) {
        log.warn("icloud calendar series rule not read", { account: this.id, code: errorCode(err) });
      }
    });
    for (const row of rows.values()) if (row.series_id && row.resource_url) row.recurrence = this.rules.get(row.resource_url)?.rule ?? null;
  }

  /**
   * Creates a queued event in iCloud Calendar, stores it with the synced events and settles the row. It goes
   * to the first event calendar iCloud lists. A request that may have reached iCloud is never sent again:
   * its row fails with a warning instead.
   */
  async createEvent(row: CalendarOutboxRow) {
    const session = this.live;
    const calendar = session?.calendars[0];
    if (!session || !calendar || this.stopped) return; // still connecting: picked up on the next pass
    if (row.account_id !== this.id || row.user_id !== this.account.user_id) {
      await failEvent(row.id, "This event belongs to another account.");
      return;
    }

    // Guests are invited from the address iCloud knows the account by; without guests it is not needed.
    if (row.attendees.length > 0 && !session.addresses) {
      try {
        session.addresses = await userAddresses(session.auth);
      } catch (err) {
        log.warn("icloud calendar address not found", { account: this.id, code: errorCode(err) });
        if (signInRejected(err)) await failEvent(row.id, SIGN_IN_REJECTED);
        return; // anything else: tried again on the next pass
      }
    }
    const organizer = session.addresses?.find((a) => this.selfAddresses.has(a)) ?? session.addresses?.[0] ?? null;
    const request = buildIcs(row, organizer);
    if ("error" in request) {
      await failEvent(row.id, request.error);
      return;
    }
    if (!(await claimEvent(row.id))) return;

    try {
      await putEvent(session.auth, calendar.url, request.uid, request.ics);
    } catch (err) {
      log.warn("icloud calendar event not created", { account: this.id, event: row.id, code: errorCode(err) });
      const status = /^HTTP_(\d+)$/.exec(errorCode(err) ?? "")?.[1];
      await failEvent(row.id, status ? createFailure(Number(status)) : MAYBE_CREATED);
      return;
    }

    const stored = parseEvents(request.ics)
      .map((e) => storedIcsEvent(e, { userId: row.user_id, accountId: this.id, calendarId: calendar.url, calendarName: calendar.name, resourceUrl: eventUrl(calendar.url, request.uid), selfAddresses: this.selfAddresses }))
      .find((r) => r);
    if (stored) {
      // Shown in the app at once. If this write fails, the next sync stores it.
      const saved = await db.from("calendar_events").upsert(await sealEvent(stored.user_id, stored), { onConflict: "account_id,provider_event_id" });
      if (saved.error) log.warn("created event not stored", { account: this.id, event: row.id, code: saved.error.code });
    }
    await settleCreated(row.id, request.uid, null);
    // A repeating event is stored as its series until the next pass fetches its occurrences, which is now.
    if (row.recurrence) this.lastFetch = null;
    log.info("icloud calendar event created", { account: this.id, event: row.id, attendees: row.attendees.length });
  }

  /**
   * Deletes an event from iCloud Calendar: its whole file, or for one occurrence of a repeating event an
   * exception added to the series (a change made only if nobody has changed the event since it was read). iCloud
   * tells the guests. An event iCloud no longer has counts as deleted. Then the stored copy is removed.
   */
  async deleteEvent(row: CalendarDeleteRow) {
    const session = this.live;
    if (!session || this.stopped) return; // still connecting: picked up on the next pass
    if (row.account_id !== this.id || row.user_id !== this.account.user_id) {
      await failDelete(row.id, "This event belongs to another account.");
      return;
    }
    const event = await storedEventOf(row);
    if (!event) {
      await failDelete(row.id, GONE);
      return;
    }
    if (!event.resource_url) {
      await failDelete(row.id, "This event is not ready to delete yet. Try again in a minute.");
      return;
    }
    if (!(await claimDelete(row.id))) return;

    try {
      if (row.scope === "series" || !event.series_id) {
        await deleteEventFile(session.auth, event.resource_url);
      } else {
        const file = await getEvent(session.auth, event.resource_url);
        const changed = excludeOccurrence(file.ics, { recurrenceId: event.provider_event_id.split("#")[1] ?? null, startsAt: event.starts_at, allDay: event.all_day });
        if (changed === null) {
          await failDelete(row.id, "This occurrence cannot be deleted on its own. Delete the whole series instead.");
          return;
        }
        await replaceEvent(session.auth, event.resource_url, changed, file.etag);
      }
    } catch (err) {
      const code = errorCode(err);
      log.warn("icloud calendar event not deleted", { account: this.id, event: row.id, code });
      if (code === "HTTP_404") {
        await settleDeleted(row, event); // already gone
        return;
      }
      await failDelete(
        row.id,
        signInRejected(err)
          ? SIGN_IN_REJECTED
          : code === "HTTP_412"
            ? "This event was changed somewhere else. Try again."
            : "iCloud Calendar did not delete this event. Try again.",
      );
      return;
    }
    await settleDeleted(row, event);
    log.info("icloud calendar event deleted", { account: this.id, event: row.id, scope: row.scope });
  }

  /** Changes an event, or answers an invitation, as queued in calendar_updates. One at a time, in the order they arrive. */
  updateEvent(row: CalendarUpdateRow): Promise<void> {
    const run = this.updates.then(() => this.applyUpdate(row));
    this.updates = run.catch(() => undefined);
    return run;
  }

  /**
   * Changes an event in iCloud Calendar: its file is read, rewritten (same UID, SEQUENCE one higher) and put back
   * only if nobody has changed it since. One occurrence of a repeating event becomes an override of the series; the
   * whole series edits the series itself. An answer to an invitation changes your PARTSTAT, which iCloud passes on
   * to the organizer. Then the stored copy is changed to match.
   */
  private async applyUpdate(row: CalendarUpdateRow) {
    const session = this.live;
    if (!session || this.stopped) return; // still connecting: picked up on the next pass
    if (row.account_id !== this.id || row.user_id !== this.account.user_id) {
      await failUpdate(row.id, "This event belongs to another account.");
      return;
    }
    const event = await storedEventOfUpdate(row);
    if (!event) {
      await failUpdate(row.id, EVENT_GONE);
      return;
    }
    if (!event.resource_url) {
      await failUpdate(row.id, "This event is not ready to change yet. Try again in a minute.");
      return;
    }
    const change = readChange(row);
    if ("error" in change) {
      await failUpdate(row.id, change.error);
      return;
    }
    const series = change.scope === "series" && !!event.series_id;
    if (change.recurrence !== undefined && event.series_id && !series) {
      await failUpdate(row.id, SERIES_RULE);
      return;
    }
    let shift: SeriesShift | null = null;
    if (series && change.time) {
      const found = seriesShift(change.time, event);
      if ("error" in found) {
        await failUpdate(row.id, found.error);
        return;
      }
      shift = found;
    }
    // Guests are invited from the address iCloud knows the account by; only an event that has none yet needs it.
    if (change.attendees && change.attendees.length > 0 && !session.addresses) {
      try {
        session.addresses = await userAddresses(session.auth);
      } catch (err) {
        log.warn("icloud calendar address not found", { account: this.id, code: errorCode(err) });
        if (signInRejected(err)) await failUpdate(row.id, SIGN_IN_REJECTED);
        return; // anything else: tried again on the next pass
      }
    }
    const organizer = session.addresses?.find((a) => this.selfAddresses.has(a)) ?? session.addresses?.[0] ?? null;
    if (!(await claimUpdate(row.id))) return;

    try {
      const file = await getEvent(session.auth, event.resource_url);
      if (!file.etag) {
        await failUpdate(row.id, "iCloud did not say which version of this event it has. Try again.");
        return;
      }
      const rewritten = updateIcs(file.ics, { change, occurrence: occurrenceOf(event), selfAddresses: this.selfAddresses, organizer });
      if ("error" in rewritten) {
        await failUpdate(row.id, rewritten.error);
        return;
      }
      await replaceEvent(session.auth, event.resource_url, rewritten.ics, file.etag);
    } catch (err) {
      const code = errorCode(err);
      log.warn("icloud calendar event not changed", { account: this.id, event: row.id, code });
      const status = /^HTTP_(\d+)$/.exec(code ?? "")?.[1];
      await failUpdate(row.id, signInRejected(err) ? SIGN_IN_REJECTED : icloudUpdateFailure(status ? Number(status) : null));
      return;
    }
    await storeChange(event, change, series, shift);
    await settleUpdated(row.id);
    if (change.recurrence !== undefined) {
      // The occurrences change with the rule: the next pass fetches them all again, and the rule with them.
      this.rules.delete(event.resource_url);
      this.lastFetch = null;
    }
    log.info("icloud calendar event changed", { account: this.id, event: row.id, kind: change.kind, scope: series ? "series" : "occurrence" });
  }
}
