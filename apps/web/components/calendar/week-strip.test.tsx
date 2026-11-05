// The phone's seven day strip (week-strip.tsx): one button per day named with its date and how many items it holds,
// the selected day pressed, and a tap handing the page that day's key.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { screen } from "@testing-library/react";
import { dayKey, fromKey } from "@/lib/dates";
import type { DayTask } from "@/lib/tasks";
import { WeekStrip } from "./week-strip";
import { longDate } from "./dates";
import { renderScreen } from "@/test/render";
import { byDay, calendarEvent, daysFromNow, weekKeys } from "@/test/calendar-fixtures";
import { task } from "@/test/fixtures";

const DAYS = weekKeys();

function renderStrip(selectedKey = DAYS[0]) {
  const events = [calendarEvent("e-1", "Site Visit", daysFromNow(1, 9)), calendarEvent("e-2", "Lease Call", daysFromNow(1, 14))];
  const tasks = new Map<string, DayTask[]>([[DAYS[1], [{ task: task("t-1", "Send the quote"), overdue: false, timed: false }]], [DAYS[3], [{ task: task("t-2", "Pay the deposit"), overdue: false, timed: false }]]]);
  const onSelect = mock.fn((_key: string) => undefined);
  const s = renderScreen(<WeekStrip days={DAYS} byDay={byDay(events)} tasksByDay={tasks} today={new Date()} selectedKey={selectedKey} onSelect={onSelect} />);
  return { ...s, onSelect };
}

test("each of the seven days is a button named by its date, with events and tasks counted together", () => {
  renderStrip();
  const buttons = screen.getAllByRole("button");
  assert.equal(buttons.length, 7);
  assert.equal(buttons[0].getAttribute("aria-label"), longDate(fromKey(DAYS[0])));
  assert.equal(buttons[1].getAttribute("aria-label"), `${longDate(fromKey(DAYS[1]))}, 3 items`);
  assert.equal(buttons[3].getAttribute("aria-label"), `${longDate(fromKey(DAYS[3]))}, 1 item`);
});

test("the selected day is pressed and the others are not", () => {
  renderStrip(DAYS[2]);
  const pressed = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true");
  assert.deepEqual(pressed.map((b) => b.getAttribute("aria-label")), [longDate(fromKey(DAYS[2]))]);
});

test("tapping a day hands the page its key", async () => {
  const { user, onSelect } = renderStrip();
  await user.click(screen.getByRole("button", { name: new RegExp(`^${longDate(fromKey(DAYS[3]))}`) }));
  assert.deepEqual(onSelect.mock.calls.map((c) => c.arguments), [[DAYS[3]]]);
});

test("today's date is the one drawn as today", () => {
  renderStrip();
  const today = screen.getAllByRole("button")[0];
  assert.equal(DAYS[0], dayKey(new Date()));
  assert.ok(today.querySelector(".bg-primary"), "today is marked");
  assert.equal(screen.getAllByRole("button")[1].querySelector(".bg-primary"), null);
});
