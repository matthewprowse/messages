import { test } from "node:test";
import assert from "node:assert/strict";
import type { Contact, Thread } from "./types";
import {
  buildEventRow,
  countryCodeOf,
  defaultCountryCode,
  defaultEventTimes,
  endsNextDay,
  existingChat,
  needsReconnect,
  normalisePhone,
  parseGuests,
  pendingEvent,
  searchEmailContacts,
  searchPhoneContacts,
  shiftEnd,
  type EventForm,
} from "./new-items";

test("normalisePhone keeps international numbers and drops spacing", () => {
  assert.equal(normalisePhone("+44 7700 900123", "27"), "+447700900123");
  assert.equal(normalisePhone("+1 (415) 555-0100", "27"), "+14155550100");
  assert.equal(normalisePhone("0044 7700 900123", "27"), "+447700900123");
});

test("normalisePhone adds the default country to national numbers", () => {
  assert.equal(normalisePhone("082 123 4567", "27"), "+27821234567");
  assert.equal(normalisePhone("821234567", "27"), "+27821234567");
  assert.equal(normalisePhone("27821234567", "27"), "+27821234567");
  assert.equal(normalisePhone("07700 900123", "44"), "+447700900123");
});

test("normalisePhone refuses what cannot be a number", () => {
  assert.equal(normalisePhone("", "27"), null);
  assert.equal(normalisePhone("jane@example.com", "27"), null);
  assert.equal(normalisePhone("+0 123 4567", "27"), null);
  assert.equal(normalisePhone("+123", "27"), null);
  assert.equal(normalisePhone("12+345678", "27"), null);
  assert.equal(normalisePhone("+1234567890123456", "27"), null);
  assert.equal(normalisePhone("+27 82 123 4567, +27 82 765 4321", "27"), null);
});

test("countryCodeOf reads one, two and three digit codes", () => {
  assert.equal(countryCodeOf("+14155550100"), "1");
  assert.equal(countryCodeOf("+79161234567"), "7");
  assert.equal(countryCodeOf("+447700900123"), "44");
  assert.equal(countryCodeOf("+27821234567"), "27");
  assert.equal(countryCodeOf("+353861234567"), "353");
  assert.equal(countryCodeOf("nope"), null);
});

test("defaultCountryCode follows your own WhatsApp number, else South Africa", () => {
  assert.equal(defaultCountryCode([{ provider: "gmail", detail: "me@x.com" }, { provider: "whatsapp", detail: "+447700900123" }]), "44");
  assert.equal(defaultCountryCode([{ provider: "gmail", detail: "me@x.com" }]), "27");
  assert.equal(defaultCountryCode([{ provider: "whatsapp", detail: "" }]), "27");
});

const thread = (p: Partial<Thread>) => ({ id: "t", channel: "whatsapp" as const, isGroup: false, lastMessageAt: "2026-10-01T00:00:00Z", ...p });

test("existingChat finds the newest one-to-one chat with the number", () => {
  const threads = [
    thread({ id: "old", fallbackName: "+27821234567", lastMessageAt: "2026-01-01T00:00:00Z" }),
    thread({ id: "new", fallbackName: "+27821234567", lastMessageAt: "2026-10-01T00:00:00Z" }),
    thread({ id: "group", fallbackName: "+27821234567", isGroup: true }),
    { ...thread({ id: "email", fallbackName: "+27821234567" }), channel: "email" as const },
  ];
  assert.equal(existingChat(threads, "+27821234567")?.id, "new");
  assert.equal(existingChat(threads, "+27820000000"), undefined);
  assert.equal(existingChat([thread({ id: "a", fallbackName: "+27821234567", accountId: "other" })], "+27821234567", "mine"), undefined);
  // A chat keyed by a privacy ID has no number of its own, so it is found through its person.
  const lid = thread({ id: "lid", participantIds: ["p"] });
  assert.equal(existingChat([lid], "+27821234567"), undefined);
  assert.equal(existingChat([lid], "+27821234567", undefined, (id) => (id === "p" ? ["+27821234567"] : undefined))?.id, "lid");
});

const contact = (p: Partial<Contact>): Contact => ({ id: "c", name: "Jane Doe", initials: "JD", hue: 0, emails: [], phones: [], ...p });

test("searchPhoneContacts matches names and digits typed nationally", () => {
  const contacts = [
    contact({ id: "jane", name: "Jane Doe", phones: ["+27821234567", "2801234567890"] }),
    contact({ id: "john", name: "John Smith", phones: [] }),
    contact({ id: "zed", name: "Zed", phones: ["+447700900123"] }),
  ];
  assert.deepEqual(searchPhoneContacts(contacts, "jane").map((r) => r.phone), ["+27821234567"]);
  assert.deepEqual(searchPhoneContacts(contacts, "082 123").map((r) => r.contact.id), ["jane"]);
  assert.deepEqual(searchPhoneContacts(contacts, "+44").map((r) => r.contact.id), ["zed"]);
  assert.deepEqual(searchPhoneContacts(contacts, "john"), []);
  assert.deepEqual(searchPhoneContacts(contacts, ""), []);
});

test("searchEmailContacts leaves out addresses already added", () => {
  const contacts = [contact({ id: "jane", emails: ["Jane@X.com", "jane@work.com"] })];
  assert.deepEqual(searchEmailContacts(contacts, "jane", ["jane@x.com"]).map((r) => r.email), ["jane@work.com"]);
});

test("parseGuests splits, lowercases and dedupes", () => {
  assert.deepEqual(parseGuests("A@x.com, a@X.com; <b@y.org> nope"), { valid: ["a@x.com", "b@y.org"], invalid: ["nope"] });
});

test("defaultEventTimes starts at the next full hour for one hour", () => {
  assert.deepEqual(defaultEventTimes(new Date(2026, 9, 23, 14, 20)), { date: "2026-10-23", startTime: "15:00", endTime: "16:00" });
  assert.deepEqual(defaultEventTimes(new Date(2026, 9, 23, 23, 5)), { date: "2026-10-24", startTime: "00:00", endTime: "01:00" });
  assert.deepEqual(defaultEventTimes(new Date(2026, 9, 23, 14, 20), "2026-10-30"), { date: "2026-10-30", startTime: "15:00", endTime: "16:00" });
  assert.deepEqual(defaultEventTimes(new Date(2026, 9, 23, 14, 20), "bad"), { date: "2026-10-23", startTime: "15:00", endTime: "16:00" });
});

test("shiftEnd keeps the length when the start moves", () => {
  assert.equal(shiftEnd("09:00", "10:30", "13:15"), "14:45");
  assert.equal(shiftEnd("23:00", "00:00", "23:30"), "00:30");
  assert.equal(shiftEnd("09:00", "09:00", "10:00"), "11:00");
});

const form = (p: Partial<EventForm> = {}): EventForm => ({
  title: " Lunch ",
  date: "2026-10-23",
  allDay: false,
  startTime: "12:00",
  endTime: "13:00",
  location: "",
  description: "",
  guests: [],
  sendInvites: true,
  addMeet: false,
  ...p,
});

test("buildEventRow builds a timed event in local time", () => {
  const r = buildEventRow(form({ guests: ["Jane@X.com", "jane@x.com"], location: " Cafe ", addMeet: true }), "acc", "Africa/Johannesburg");
  assert.ok(r.ok);
  assert.deepEqual(r.row, {
    account_id: "acc",
    title: "Lunch",
    description: null,
    location: "Cafe",
    starts_at: new Date(2026, 9, 23, 12, 0).toISOString(),
    ends_at: new Date(2026, 9, 23, 13, 0).toISOString(),
    all_day: false,
    time_zone: "Africa/Johannesburg",
    attendees: ["jane@x.com"],
    send_invites: true,
    add_meet: true,
  });
});

test("buildEventRow runs an end before the start into the next day", () => {
  const r = buildEventRow(form({ startTime: "22:00", endTime: "01:00" }), "acc", "Europe/London");
  assert.ok(r.ok);
  assert.equal(r.row.ends_at, new Date(2026, 9, 24, 1, 0).toISOString());
  assert.equal(endsNextDay(form({ startTime: "22:00", endTime: "01:00" })), true);
  assert.equal(endsNextDay(form()), false);
});

test("buildEventRow makes all-day events midnight to midnight", () => {
  const r = buildEventRow(form({ allDay: true, startTime: "", endTime: "" }), "acc", "Europe/London");
  assert.ok(r.ok);
  assert.equal(r.row.all_day, true);
  assert.equal(r.row.starts_at, new Date(2026, 9, 23).toISOString());
  assert.equal(r.row.ends_at, new Date(2026, 9, 24).toISOString());
});

test("pendingEvent is the queued event as the Calendar shows it", () => {
  const people = [{ id: "c1", name: "Jane Doe", emails: ["Jane@x.com"] }] as Contact[];
  const timed = buildEventRow(form({ guests: ["jane@x.com", "bob@y.com"], location: "Cafe" }), "acc", "Europe/London");
  assert.ok(timed.ok);
  const e = pendingEvent("q1", timed.row, "2026-10-23", people);
  assert.deepEqual([e.id, e.title, e.allDay, e.startsAt, e.endsAt, e.location], ["q1", timed.row.title, false, timed.row.starts_at, timed.row.ends_at, "Cafe"]);
  assert.deepEqual(e.attendees, [
    { email: "jane@x.com", name: "Jane Doe", contactId: "c1" },
    { email: "bob@y.com", name: "bob@y.com", contactId: null },
  ]);
  // An all-day event is midnight UTC on its date, the day after at the end, as the worker stores it.
  const allDay = buildEventRow(form({ allDay: true, startTime: "", endTime: "" }), "acc", "Europe/London");
  assert.ok(allDay.ok);
  const d = pendingEvent("q2", allDay.row, "2026-10-31", []);
  assert.deepEqual([d.allDay, d.startsAt, d.endsAt], [true, "2026-10-31T00:00:00.000Z", "2026-11-01T00:00:00.000Z"]);
});

test("buildEventRow names the first thing to fix", () => {
  const fail = (p: Partial<EventForm>) => {
    const r = buildEventRow(form(p), "acc", "Europe/London");
    return r.ok ? null : r.field;
  };
  assert.equal(fail({ title: "  " }), "title");
  assert.equal(fail({ title: "x".repeat(301) }), "title");
  assert.equal(fail({ date: "2026-02-30" }), "date");
  assert.equal(fail({ startTime: "12:00", endTime: "12:00" }), "time");
  assert.equal(fail({ startTime: "25:00" }), "time");
  assert.equal(fail({ location: "x".repeat(501) }), "location");
  assert.equal(fail({ description: "x".repeat(8001) }), "description");
  assert.equal(fail({ guests: ["nope"] }), "guests");
  assert.equal(fail({ guests: Array.from({ length: 51 }, (_, i) => `g${i}@x.com`) }), "guests");
  assert.equal(fail({ title: "x".repeat(300), guests: Array.from({ length: 50 }, (_, i) => `g${i}@x.com`) }), null);
});

test("needsReconnect spots the worker's reconnect message", () => {
  assert.equal(needsReconnect("Reconnect Google to allow creating events. Run pnpm connect:google."), true);
  assert.equal(needsReconnect("iCloud rejected the sign-in. Run pnpm connect:icloud-calendar to reconnect."), true);
  assert.equal(needsReconnect("Google Calendar could not be reached."), false);
  assert.equal(needsReconnect(undefined), false);
});

test("existingChat keeps the first of two chats with the same time", () => {
  const threads = [thread({ id: "a", fallbackName: "+27821234567" }), thread({ id: "b", fallbackName: "+27821234567" })];
  assert.equal(existingChat(threads, "+27821234567")?.id, "a");
  assert.equal(existingChat([thread({ id: "c", fallbackName: "+27821234567" })], "+27821234567", "mine")?.id, "c");
});
