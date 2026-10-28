// Tests for caldav/client.ts. Pin down which iCloud calendars are kept from a PROPFIND answer, that no request follows a
// calendar to a host outside iCloud, and that a changed event file is never overwritten (If-Match).

import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteEventFile, eventCalendars, eventsIn, getEvent, replaceEvent, type DavEvent } from "./client";

const HOME = "https://p12-caldav.icloud.com:443/1234/calendars/";
const response = (href: string, resourcetype: string, extra = "") =>
  `<response><href>${href}</href><propstat><prop><resourcetype>${resourcetype}</resourcetype>${extra}</prop><status>HTTP/1.1 200 OK</status></propstat></response>`;
const comps = (...names: string[]) => `<C:supported-calendar-component-set>${names.map((n) => `<C:comp name="${n}"/>`).join("")}</C:supported-calendar-component-set>`;

test("keeps calendars that hold events", () => {
  const xml = `<multistatus xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">
    ${response("/1234/calendars/", "<collection/>")}
    ${response("/1234/calendars/home/", "<collection/><C:calendar/>", `${comps("VEVENT", "VTODO")}<CS:getctag>ctag-1</CS:getctag>`)}
    ${response("/1234/calendars/work/", "<collection/><C:calendar/>", comps("VEVENT"))}
    ${response("/1234/calendars/reminders/", "<collection/><C:calendar/>", comps("VTODO"))}
    ${response("/1234/calendars/holidays/", "<collection/><C:calendar/><CS:subscribed/>", comps("VEVENT"))}
    ${response("/1234/calendars/inbox/", "<collection/><C:schedule-inbox/>")}
  </multistatus>`;
  assert.deepEqual(eventCalendars(xml, HOME), [
    { url: "https://p12-caldav.icloud.com/1234/calendars/home/", ctag: "ctag-1", name: null },
    { url: "https://p12-caldav.icloud.com/1234/calendars/work/", ctag: null, name: null },
  ]);
});

test("reads the single-quoted attributes iCloud sends", () => {
  const xml = `<multistatus xmlns="DAV:"><response><href>/1234/calendars/home/</href><propstat><prop><resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name='VEVENT' xmlns='urn:ietf:params:xml:ns:caldav'/></supported-calendar-component-set></prop></propstat></response></multistatus>`;
  assert.deepEqual(eventCalendars(xml, HOME), [{ url: "https://p12-caldav.icloud.com/1234/calendars/home/", ctag: null, name: null }]);
});

test("never follows a calendar to a host that is not iCloud", () => {
  const xml = `<multistatus>${response("https://evil.example.com/steal/", "<collection/><calendar/>")}</multistatus>`;
  assert.throws(() => eventCalendars(xml, HOME), /not iCloud/);
});

/** Runs fn with fetch answering as given, and returns what was asked of it. */
async function withFetch(answer: (url: string, init: RequestInit) => Response, fn: () => Promise<unknown>) {
  const asked: { url: string; method: string; headers: Record<string, string> }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(url), method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string> });
    return answer(String(url), init ?? {});
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
  return asked;
}

test("reads each event with the file it comes from", async () => {
  const body = `<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
    <response><href>/1234/calendars/home/ABC.ics</href><propstat><prop><getetag>"1"</getetag><C:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:ABC
SUMMARY:Lunch &amp; learn
END:VEVENT
END:VCALENDAR</C:calendar-data></prop></propstat></response>
    <response><href>/1234/calendars/home/</href><propstat><prop/></propstat></response>
  </multistatus>`;
  let events: DavEvent[] = [];
  await withFetch(() => new Response(body, { status: 207 }), async () => {
    events = await eventsIn("Basic x", "https://p12-caldav.icloud.com/1234/calendars/home/", { timeMin: "2026-10-18T00:00:00.000Z", timeMax: "2026-12-24T00:00:00.000Z" });
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].url, "https://p12-caldav.icloud.com/1234/calendars/home/ABC.ics");
  assert.ok(events[0].ics.includes("SUMMARY:Lunch & learn"));
});

test("deletes, reads and changes an event file only on iCloud, and never replaces one that changed", async () => {
  const url = "https://p12-caldav.icloud.com/1234/calendars/home/ABC.ics";
  const asked = await withFetch(
    (_u, init) => (init.method === "GET" ? new Response("BEGIN:VCALENDAR", { status: 200, headers: { etag: '"7"' } }) : new Response(null, { status: init.method === "DELETE" ? 204 : 204 })),
    async () => {
      const file = await getEvent("Basic x", url);
      assert.deepEqual(file, { ics: "BEGIN:VCALENDAR", etag: '"7"' });
      await replaceEvent("Basic x", url, "BEGIN:VCALENDAR\nEND:VCALENDAR", file.etag);
      await deleteEventFile("Basic x", url);
    },
  );
  assert.deepEqual(asked.map((a) => a.method), ["GET", "PUT", "DELETE"]);
  assert.equal(asked[1].headers["if-match"], '"7"');

  await withFetch(() => new Response(null, { status: 404 }), () => deleteEventFile("Basic x", url)); // already gone
  await assert.rejects(withFetch(() => new Response(null, { status: 412 }), () => replaceEvent("Basic x", url, "x", '"7"')), { code: "HTTP_412" });
  await assert.rejects(withFetch(() => new Response(null, { status: 500 }), () => deleteEventFile("Basic x", url)), { code: "HTTP_500" });
  await assert.rejects(deleteEventFile("Basic x", "https://evil.example.com/ABC.ics"), /not iCloud/);
});
