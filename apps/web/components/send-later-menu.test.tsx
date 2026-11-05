// The Send Later menu on its own (send-later-menu.tsx): the quick times it offers, the time each one hands back, and the
// Pick a Date and Time dialog, which starts on tomorrow at 08:00 and refuses a time already past.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { screen, within } from "@testing-library/react";
import { laterChoices } from "@/lib/send-schedule";
import { SendLaterMenu } from "./send-later-menu";
import { renderScreen } from "@/test/render";

function renderMenu(disabled = false) {
  const onPick = mock.fn((_at: Date) => undefined);
  const s = renderScreen(<SendLaterMenu disabled={disabled} onPick={onPick} />);
  return { ...s, onPick, picked: () => onPick.mock.calls.map((c) => c.arguments[0]) };
}

/** Tomorrow at a given hour and minute, local time. */
function tomorrowAt(h: number, m = 0) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  return d;
}

test("the menu offers the quick times for now, then Pick a Date and Time", async () => {
  const { user } = renderMenu();
  await user.click(screen.getByRole("button", { name: "Send Later" }));
  const items = (await screen.findAllByRole("menuitem")).map((i) => i.textContent ?? "");
  const expected = laterChoices(new Date()).map((c) => c.label);
  assert.deepEqual(items.slice(0, -1).map((t) => expected.find((l) => t.startsWith(l))), expected);
  assert.equal(items.at(-1), "Pick a Date and Time");
});

test("Tomorrow Morning hands back tomorrow at 08:00", async () => {
  const { user, picked } = renderMenu();
  await user.click(screen.getByRole("button", { name: "Send Later" }));
  await user.click(await screen.findByRole("menuitem", { name: /^Tomorrow Morning/ }));
  assert.deepEqual(picked().map((d) => d.getTime()), [tomorrowAt(8).getTime()]);
});

test("the button is off while there is nothing to send", () => {
  renderMenu(true);
  assert.equal((screen.getByRole("button", { name: "Send Later" }) as HTMLButtonElement).disabled, true);
});

test("Pick a Date and Time starts on tomorrow at 08:00, and Schedule hands that back", async () => {
  const { user, picked } = renderMenu();
  await user.click(screen.getByRole("button", { name: "Send Later" }));
  await user.click(await screen.findByRole("menuitem", { name: "Pick a Date and Time" }));
  const dialog = await screen.findByRole("dialog", { name: "Send Later" });
  assert.equal(within(dialog).getByRole("combobox").textContent, "08:00");
  await user.click(within(dialog).getByRole("button", { name: "Schedule" }));
  assert.deepEqual(picked().map((d) => d.getTime()), [tomorrowAt(8).getTime()]);
  assert.equal(screen.queryByRole("dialog"), null);
});

test("a time picked from the list is the one scheduled", async () => {
  const { user, picked } = renderMenu();
  await user.click(screen.getByRole("button", { name: "Send Later" }));
  await user.click(await screen.findByRole("menuitem", { name: "Pick a Date and Time" }));
  const dialog = await screen.findByRole("dialog", { name: "Send Later" });
  await user.click(within(dialog).getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name: "09:30" }));
  await user.click(within(dialog).getByRole("button", { name: "Schedule" }));
  assert.deepEqual(picked().map((d) => d.getTime()), [tomorrowAt(9, 30).getTime()]);
});

test("today at midnight is refused with a reason, and nothing is scheduled", async () => {
  const { user, onPick } = renderMenu();
  await user.click(screen.getByRole("button", { name: "Send Later" }));
  await user.click(await screen.findByRole("menuitem", { name: "Pick a Date and Time" }));
  const dialog = await screen.findByRole("dialog", { name: "Send Later" });
  await user.click(within(dialog).getByLabelText("Date"));
  const today = document.querySelector<HTMLButtonElement>("[data-today=true] button, [data-today] button");
  assert.ok(today, "the calendar marks today");
  await user.click(today);
  await user.click(within(dialog).getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name: "00:00" }));
  await user.click(within(dialog).getByRole("button", { name: "Schedule" }));
  assert.ok(within(dialog).getByText("Choose a time in the future."));
  assert.equal(onPick.mock.callCount(), 0);
});
