// An event on the Summary (event-row.tsx): when it is (its time, All Day, or Ongoing for one that began before today)
// and a link to it in Calendar.

import { test } from "node:test";
import assert from "node:assert/strict";
import { screen } from "@testing-library/react";
import { dayKey } from "@/lib/dates";
import { timeOf } from "@/lib/format";
import { EventRow } from "./event-row";
import { renderScreen } from "@/test/render";
import { calendarEvent, daysFromNow } from "@/test/calendar-fixtures";

const TODAY = dayKey(new Date());

test("a timed event shows its start time and opens itself in Calendar", () => {
  // Five hours from now is never soon enough to look for a prep brief, so nothing is read.
  const start = new Date(Date.now() + 5 * 3_600_000);
  const event = calendarEvent("event-visit", "Site Visit", start);
  renderScreen(<EventRow event={event} today={TODAY} />);
  const link = screen.getByRole("link", { name: /Site Visit/ });
  assert.equal(link.getAttribute("href"), `/calendar?date=${TODAY}&event=event-visit`);
  assert.ok(screen.getByText(timeOf(event.startsAt)));
});

test("an all-day event says All Day", () => {
  renderScreen(<EventRow event={calendarEvent("event-holiday", "Public Holiday", daysFromNow(0, 0), { allDay: true })} today={TODAY} />);
  // The time slot beside the title, whatever the detail line under it says.
  assert.match(screen.getByRole("link").textContent ?? "", /^Public HolidayAll Day/);
});

test("a timed event that began before today says Ongoing", () => {
  renderScreen(<EventRow event={calendarEvent("event-conference", "Trade Conference", daysFromNow(-1, 9), { endsAt: daysFromNow(1, 17).toISOString() })} today={TODAY} />);
  assert.ok(screen.getByText("Ongoing"));
});
