// The calendar's month grid (month-view.tsx): each day a button that names its events and tasks, the event titles in
// the right day, the selected day pressed, a click selecting the day and a double click starting a new event on it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { screen, within } from "@testing-library/react";
import { addDays, dayKey, fromKey } from "@/lib/dates";
import type { DayTask } from "@/lib/tasks";
import { MonthView } from "./month-view";
import { longDate } from "./dates";
import { renderScreen } from "@/test/render";
import { byDay, calendarEvent, daysFromNow } from "@/test/calendar-fixtures";
import { task } from "@/test/fixtures";

// Six weeks from the Monday on or before today, as the page lays out a month.
const today = new Date();
const monday = addDays(new Date(today.getFullYear(), today.getMonth(), today.getDate()), -((today.getDay() + 6) % 7));
const DAYS = Array.from({ length: 42 }, (_, i) => dayKey(addDays(monday, i)));
const VISIT = calendarEvent("e-visit", "Site Visit", daysFromNow(2, 10));
const HOLIDAY = calendarEvent("e-holiday", "Public Holiday", daysFromNow(2, 0), { allDay: true });
const named = (key: string) => new RegExp(`^${longDate(fromKey(key))}(,|$)`);

function renderMonth(selected = today) {
  const tasks = new Map<string, DayTask[]>([[dayKey(daysFromNow(2)), [{ task: task("t-1", "Send the quote"), overdue: false, timed: false }]]]);
  const onSelect = mock.fn((_d: Date) => undefined);
  const onCreate = mock.fn((_key: string) => undefined);
  const s = renderScreen(<MonthView days={DAYS} byDay={byDay([VISIT, HOLIDAY])} tasksByDay={tasks} today={today} selected={selected} monthOf={today} onSelect={onSelect} onCreate={onCreate} />);
  return { ...s, onSelect, onCreate };
}

test("the grid is six weeks of day buttons under the seven weekday names", () => {
  renderMonth();
  assert.equal(screen.getAllByRole("button").length, 42);
  assert.ok(screen.getByText(monday.toLocaleDateString("en-GB", { weekday: "short" })));
});

test("a day with events and a task says so in its name and lists the titles in its own cell", () => {
  renderMonth();
  const key = dayKey(daysFromNow(2));
  const day = screen.getByRole("button", { name: named(key) });
  assert.equal(day.getAttribute("aria-label"), `${longDate(fromKey(key))}, 2 events, 1 task`);
  assert.ok(within(day).getByText("Site Visit"));
  assert.ok(within(day).getByText("Public Holiday"));
  assert.ok(within(day).getByText("Send the quote"));
  // Nothing leaks into the day before.
  const before = screen.getByRole("button", { name: named(dayKey(daysFromNow(1))) });
  assert.equal(within(before).queryByText("Site Visit"), null);
});

test("the selected day is pressed", () => {
  renderMonth(daysFromNow(2));
  const pressed = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true");
  assert.equal(pressed.length, 1);
  assert.match(pressed[0].getAttribute("aria-label") ?? "", named(dayKey(daysFromNow(2))));
});

test("a click selects the day and a double click starts a new event on it", async () => {
  const { user, onSelect, onCreate } = renderMonth();
  const key = dayKey(daysFromNow(3));
  const day = screen.getByRole("button", { name: named(key) });
  await user.click(day);
  assert.equal(dayKey(onSelect.mock.calls[0].arguments[0]), key);
  await user.dblClick(day);
  assert.deepEqual(onCreate.mock.calls.map((c) => c.arguments), [[key]]);
});

test("more than three items in a day shows how many more", () => {
  const busy = [1, 2, 3, 4, 5].map((n) => calendarEvent(`e-${n}`, `Meeting ${n}`, daysFromNow(4, 8 + n)));
  renderScreen(<MonthView days={DAYS} byDay={byDay(busy)} tasksByDay={new Map()} today={today} selected={today} monthOf={today} onSelect={() => undefined} onCreate={() => undefined} />);
  const day = screen.getByRole("button", { name: named(dayKey(daysFromNow(4))) });
  assert.ok(within(day).getByText("2 more"));
  assert.equal(within(day).queryByText("Meeting 4"), null);
});
