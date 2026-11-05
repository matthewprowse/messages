// The Schedule button in a conversation's header (schedule-button.tsx): it opens New Event with the conversation's
// subject as the title and its people as guests, and can be driven from outside (the phone's More menu).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { screen } from "@testing-library/react";
import { ScheduleButton } from "./schedule-button";
import { renderScreen } from "@/test/render";
import { CALENDAR_ACCOUNT } from "@/test/calendar-fixtures";
import { AVA, KITCHEN } from "@/test/fixtures";

test("Schedule opens New Event titled with the subject and with the person as a guest", async () => {
  const { user } = renderScreen(<ScheduleButton thread={KITCHEN} />, { accounts: [CALENDAR_ACCOUNT], contacts: [AVA] });
  assert.equal(screen.queryByRole("dialog"), null);
  await user.click(screen.getByRole("button", { name: "Schedule" }));
  assert.ok(await screen.findByRole("dialog", { name: "New Event" }));
  assert.equal((screen.getByLabelText("Title") as HTMLInputElement).value, KITCHEN.subject);
  assert.ok(screen.getByText(AVA.name));
});

test("when the header drives it, the button asks to open rather than opening itself", async () => {
  const onOpenChange = mock.fn((_open: boolean) => undefined);
  const { user } = renderScreen(<ScheduleButton thread={KITCHEN} open={false} onOpenChange={onOpenChange} />, { accounts: [CALENDAR_ACCOUNT], contacts: [AVA] });
  await user.click(screen.getByRole("button", { name: "Schedule" }));
  assert.deepEqual(onOpenChange.mock.calls.map((c) => c.arguments), [[true]]);
  assert.equal(screen.queryByRole("dialog"), null);
});
