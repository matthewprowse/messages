// Tests for event-calendars.ts: the calendars offered for a new event, the guess at each account's default, and the
// remembered default surviving blocked or broken storage.

import assert from "node:assert/strict";
import { test } from "node:test";
import { browserStorage, calendarChoices, choiceKey, guessDefault, initialChoice, isReadOnlyCalendar, readDefaults, writeDefault } from "./event-calendars";

const work = { id: "a1", label: "Google Calendar", detail: "me@firm.co.za" };
const home = { id: "a2", label: "iCloud Calendar", detail: "me@icloud.com" };
const rows = (account: string, id: string, name: string | null, n: number) => Array.from({ length: n }, () => ({ account_id: account, calendar_id: id, calendar_name: name }));

test("calendars that only show things are not offered", () => {
  assert.ok(isReadOnlyCalendar("en.sa#holiday@group.v.calendar.google.com"));
  assert.ok(isReadOnlyCalendar("addressbook#contacts@group.v.calendar.google.com"));
  assert.ok(!isReadOnlyCalendar("me@firm.co.za"));
});

test("an account with no stored events offers its primary calendar", () => {
  const choices = calendarChoices([work], [], {});
  assert.equal(choices.length, 1);
  assert.equal(choices[0].calendarId, "primary");
  assert.equal(choices[0].key, choiceKey("a1", "primary"));
  assert.ok(choices[0].isDefault);
});

test("each stored calendar is a choice, holidays are left out and the account's own address is the guessed default", () => {
  const stored = [...rows("a1", "me@firm.co.za", "Work", 3), ...rows("a1", "team@firm.co.za", "Team", 20), ...rows("a1", "en.sa#holiday@group.v.calendar.google.com", "Holidays", 9)];
  const choices = calendarChoices([work], stored, {});
  assert.deepEqual(choices.map((c) => c.calendarId), ["team@firm.co.za", "me@firm.co.za"]);
  assert.deepEqual(choices.filter((c) => c.isDefault).map((c) => c.calendarId), ["me@firm.co.za"]);
});

test("without the account's own address the calendar with most events is the guess", () => {
  assert.equal(guessDefault(home, [{ calendarId: "https://p01/home", events: 4 }, { calendarId: "https://p01/work", events: 40 }]), "https://p01/work");
  assert.equal(guessDefault(home, []), "primary");
});

test("a remembered default wins, per account, and is ignored when that calendar is gone", () => {
  const stored = [...rows("a1", "me@firm.co.za", "Work", 3), ...rows("a1", "team@firm.co.za", "Team", 20), ...rows("a2", "https://p01/home", "Home", 2)];
  const choices = calendarChoices([work, home], stored, { a1: "team@firm.co.za", a2: "https://p01/deleted" });
  assert.deepEqual(choices.filter((c) => c.isDefault).map((c) => c.key), [choiceKey("a1", "team@firm.co.za"), choiceKey("a2", "https://p01/home")]);
});

test("with several accounts each choice says which account it is in", () => {
  const choices = calendarChoices([work, home], [...rows("a1", "me@firm.co.za", "Work", 1), ...rows("a2", "https://p01/home", "Home", 1)], {});
  assert.deepEqual(choices.map((c) => c.label), ["Work (me@firm.co.za)", "Home (me@icloud.com)"]);
});

test("a new event opens on the one asked for, else the first account's default", () => {
  const choices = calendarChoices([work, home], [...rows("a1", "me@firm.co.za", "Work", 1), ...rows("a2", "https://p01/home", "Home", 1)], {});
  assert.equal(initialChoice(choices, choiceKey("a2", "https://p01/home"))?.accountId, "a2");
  assert.equal(initialChoice(choices, "gone|gone")?.accountId, "a1");
  assert.equal(initialChoice([], null), undefined);
});

test("the default is remembered through storage, and a broken storage changes nothing", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  assert.deepEqual(readDefaults(storage), {});
  writeDefault(storage, "a1", "team@firm.co.za");
  assert.deepEqual(writeDefault(storage, "a2", "home"), { a1: "team@firm.co.za", a2: "home" });
  assert.deepEqual(readDefaults(storage), { a1: "team@firm.co.za", a2: "home" });
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(readDefaults(broken), {});
  assert.deepEqual(writeDefault(broken, "a1", "x"), { a1: "x" });
  assert.deepEqual(readDefaults({ getItem: () => "[1,2]", setItem: () => undefined }), {});
  assert.equal(browserStorage(), null); // no window in tests
});
