// iCloud Calendar over CalDAV, signed in with an app-specific password. It finds your calendars, reads
// their events, adds new ones and deletes the ones you ask it to (a whole event, or one occurrence of a
// repeating event by adding an exception to it). Nothing else is ever changed.

import { unescapeXml } from "../photos/cards";

const ROOT = "https://caldav.icloud.com/";
const DAV = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"';

export interface DavCalendar {
  url: string;
  /** Changes whenever anything in the calendar does, so an unchanged calendar needs no fetch. */
  ctag: string | null;
  /** What it is called in Calendar, such as "Home". */
  name: string | null;
}

/** One event's file on the server, as REPORT returns it. */
export interface DavEvent {
  /** Where the file is, which deleting or changing the event needs. */
  url: string;
  ics: string;
}

/** The Authorization header for this sign-in, built once and passed to every request. */
export function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

/** iCloud answers a sign-in it rejects with 401. Anything else is worth retrying. */
export function signInRejected(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "HTTP_401";
}

/** A URL on iCloud's own hosts, the only place the sign-in is ever sent. */
function icloudUrl(href: string, base: string): string {
  const url = new URL(href, base);
  if (url.protocol !== "https:" || !/(^|\.)icloud\.com$/i.test(url.hostname)) throw Object.assign(new Error("caldav host is not iCloud"), { code: "BAD_HOST" });
  return url.href;
}

async function dav(auth: string, url: string, method: "PROPFIND" | "REPORT", depth: 0 | 1, body: string): Promise<string> {
  const response = await fetch(url, {
    method,
    headers: { authorization: auth, depth: String(depth), "content-type": "application/xml; charset=utf-8" },
    body: `<?xml version="1.0" encoding="utf-8"?>${body}`,
    signal: AbortSignal.timeout(120_000),
    redirect: "error", // a redirect could carry the sign-in somewhere else
  });
  if (response.status !== 207) {
    await response.body?.cancel().catch(() => undefined);
    throw Object.assign(new Error("caldav request failed"), { code: `HTTP_${response.status}` });
  }
  return response.text();
}

function hrefIn(xml: string, property: string): string | null {
  const block = new RegExp(`<(?:\\w+:)?${property}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${property}>`).exec(xml)?.[1];
  const href = block && /<(?:\w+:)?href[^>]*>([^<]+)<\/(?:\w+:)?href>/.exec(block)?.[1];
  return href ? unescapeXml(href.trim()) : null;
}

/** This sign-in's principal, the page that says where its calendars and addresses are. */
async function principalUrl(auth: string): Promise<string> {
  const principalXml = await dav(auth, ROOT, "PROPFIND", 0, `<d:propfind ${DAV}><d:prop><d:current-user-principal/></d:prop></d:propfind>`);
  const principal = hrefIn(principalXml, "current-user-principal");
  if (!principal) throw Object.assign(new Error("no principal"), { code: "NO_PRINCIPAL" });
  return icloudUrl(principal, ROOT);
}

/** The email addresses iCloud knows this account by, for naming the organizer of an event with guests. */
export async function userAddresses(auth: string): Promise<string[]> {
  const xml = await dav(auth, await principalUrl(auth), "PROPFIND", 0, `<d:propfind ${DAV}><d:prop><c:calendar-user-address-set/></d:prop></d:propfind>`);
  const out: string[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?href[^>]*>\s*mailto:([^<\s]+)\s*<\/(?:\w+:)?href>/gi)) {
    const email = unescapeXml(m[1]).toLowerCase();
    if (email.includes("@") && !out.includes(email)) out.push(email);
  }
  return out;
}

/** Where this sign-in's calendars live. Throws with a code when iCloud does not say. */
export async function calendarHome(auth: string): Promise<string> {
  const principal = await principalUrl(auth);
  const homeXml = await dav(auth, principal, "PROPFIND", 0, `<d:propfind ${DAV}><d:prop><c:calendar-home-set/></d:prop></d:propfind>`);
  const home = hrefIn(homeXml, "calendar-home-set");
  if (!home) throw Object.assign(new Error("no calendar home"), { code: "NO_HOME" });
  return icloudUrl(home, principal);
}

/**
 * The calendars that hold events. Reminder lists, the scheduling inbox and outbox, and subscribed
 * calendars (public holidays, birthdays) are left out.
 */
export function eventCalendars(multistatus: string, homeUrl: string): DavCalendar[] {
  const found: DavCalendar[] = [];
  for (const m of multistatus.matchAll(/<(?:\w+:)?response[^>]*>([\s\S]*?)<\/(?:\w+:)?response>/g)) {
    const block = m[1];
    if (!/<(?:\w+:)?calendar(\s[^>]*)?\/>/.test(block) || /<(?:\w+:)?subscribed(\s[^>]*)?\/>/.test(block)) continue;
    const components = /<(?:\w+:)?supported-calendar-component-set[^>]*>([\s\S]*?)<\/(?:\w+:)?supported-calendar-component-set>/.exec(block)?.[1];
    if (components !== undefined && !/name=["']VEVENT["']/i.test(components)) continue;
    const href = /<(?:\w+:)?href[^>]*>([^<]+)<\/(?:\w+:)?href>/.exec(block)?.[1];
    if (!href) continue;
    const ctag = /<(?:\w+:)?getctag[^>]*>([^<]*)<\/(?:\w+:)?getctag>/.exec(block)?.[1]?.trim() || null;
    const name = /<(?:\w+:)?displayname[^>]*>([^<]*)<\/(?:\w+:)?displayname>/.exec(block)?.[1];
    found.push({ url: icloudUrl(unescapeXml(href.trim()), homeUrl), ctag, name: name ? unescapeXml(name).trim() || null : null });
  }
  return found;
}

export async function listCalendars(auth: string, homeUrl: string): Promise<DavCalendar[]> {
  const xml = await dav(
    auth,
    homeUrl,
    "PROPFIND",
    1,
    `<d:propfind ${DAV}><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><cs:getctag/></d:prop></d:propfind>`,
  );
  return eventCalendars(xml, homeUrl);
}

/** CalDAV's UTC time format: 20261024T080000Z. */
const davTime = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * Every event in the window with the file it comes from, repeating events already split into their
 * occurrences (each occurrence names the file of its whole series).
 */
export async function eventsIn(auth: string, calendarUrl: string, window: { timeMin: string; timeMax: string }): Promise<DavEvent[]> {
  const start = davTime(window.timeMin);
  const end = davTime(window.timeMax);
  const xml = await dav(
    auth,
    calendarUrl,
    "REPORT",
    1,
    `<c:calendar-query ${DAV}><d:prop><d:getetag/><c:calendar-data><c:expand start="${start}" end="${end}"/></c:calendar-data></d:prop>` +
      `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`,
  );
  const out: DavEvent[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?response[^>]*>([\s\S]*?)<\/(?:\w+:)?response>/g)) {
    const href = /<(?:\w+:)?href[^>]*>([^<]+)<\/(?:\w+:)?href>/.exec(m[1])?.[1];
    const data = /<(?:\w+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:\w+:)?calendar-data>/.exec(m[1])?.[1];
    if (href && data !== undefined) out.push({ url: icloudUrl(unescapeXml(href.trim()), calendarUrl), ics: unescapeXml(data.replace(/^<!\[CDATA\[|\]\]>$/g, "")) });
  }
  return out;
}

/** An event's file as it is now, with the tag that says which version it is. */
export async function getEvent(auth: string, url: string): Promise<{ ics: string; etag: string | null }> {
  const response = await fetch(icloudUrl(url, ROOT), { method: "GET", headers: { authorization: auth }, signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw Object.assign(new Error("caldav read failed"), { code: `HTTP_${response.status}` });
  }
  return { ics: await response.text(), etag: response.headers.get("etag") };
}

/** Replaces an event's file, only if nobody has changed it since etag, so a change made elsewhere is never overwritten. */
export async function replaceEvent(auth: string, url: string, ics: string, etag: string | null): Promise<void> {
  const response = await fetch(icloudUrl(url, ROOT), {
    method: "PUT",
    headers: { authorization: auth, "content-type": "text/calendar; charset=utf-8", ...(etag ? { "if-match": etag } : {}) },
    body: ics,
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  await response.body?.cancel().catch(() => undefined);
  if (response.status !== 201 && response.status !== 204) throw Object.assign(new Error("caldav change failed"), { code: `HTTP_${response.status}` });
}

/** Deletes an event's file. An event that is already gone counts as deleted. */
export async function deleteEventFile(auth: string, url: string): Promise<void> {
  const response = await fetch(icloudUrl(url, ROOT), { method: "DELETE", headers: { authorization: auth }, signal: AbortSignal.timeout(30_000), redirect: "error" });
  await response.body?.cancel().catch(() => undefined);
  if (response.status !== 204 && response.status !== 200 && response.status !== 404) throw Object.assign(new Error("caldav delete failed"), { code: `HTTP_${response.status}` });
}

/**
 * Adds an event as its own resource in a calendar. If-None-Match: * makes iCloud refuse to replace one that
 * already exists, so the same request can never overwrite an event. Throws with code HTTP_<status> when
 * iCloud refuses it.
 */
/** Where an event with this UID is filed in a calendar. */
export function eventUrl(calendarUrl: string, uid: string): string {
  return icloudUrl(`${encodeURIComponent(uid)}.ics`, calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`);
}

export async function putEvent(auth: string, calendarUrl: string, uid: string, ics: string): Promise<void> {
  const url = eventUrl(calendarUrl, uid);
  const response = await fetch(url, {
    method: "PUT",
    headers: { authorization: auth, "content-type": "text/calendar; charset=utf-8", "if-none-match": "*" },
    body: ics,
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  await response.body?.cancel().catch(() => undefined);
  if (response.status !== 201 && response.status !== 204) throw Object.assign(new Error("caldav create failed"), { code: `HTTP_${response.status}` });
}
