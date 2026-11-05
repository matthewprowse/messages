// Guided reply choices (guided-choices.tsx): the choices triage left on the latest message appear as buttons only while
// the conversation waits on you, picking one asks for that draft, an availability question is checked against the
// calendar with Suggest Another Time offering free slots, and Add to Calendar opens New Event filled in from the plan.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { screen, within } from "@testing-library/react";
import { GuidedChoices } from "./guided-choices";
import { fakeSupabase } from "@/test/fake-supabase";
import { renderScreen } from "@/test/render";
import { ACCOUNT, KITCHEN, KITCHEN_MESSAGES } from "@/test/fixtures";
import type { Account } from "@/lib/types";
import type { Decision, Message } from "@/lib/types";

const ACCEPT = { label: "Yes, Thursday Works", decision: "I can meet on Thursday.", kind: "accept" };
const DECLINE = { label: "Not This Week", decision: "I cannot meet this week.", kind: "decline" };
const OTHER = { label: "Suggest Another Time", decision: "I would like another time.", kind: "other_time" };

/** "YYYY-MM-DDTHH:MM" local, the form triage writes times in, days from today at an hour. */
function localAt(days: number, hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
}

/** Triage's stored choices for a message, answered by the fake database. */
function triageLeft(choices: Record<string, unknown>) {
  fakeSupabase.answer("from:message_ai", { data: { reply_choices: JSON.stringify(choices) }, error: null });
}

/** A connected calendar, so New Event has somewhere to put the event. */
const CALENDAR: Account = { id: "account-calendar", provider: "google_calendar", label: "Google Calendar", detail: "screen-test-inbox@example.com", status: "connected", sendAddresses: [] };

function renderChoices(msgs: Message[] = KITCHEN_MESSAGES, disabled = false) {
  const onPick = mock.fn((_d: Decision) => undefined);
  const s = renderScreen(<GuidedChoices thread={KITCHEN} msgs={msgs} disabled={disabled} onPick={onPick} />, { accounts: [ACCOUNT, CALENDAR] });
  return { ...s, onPick, picks: () => onPick.mock.calls.map((c) => c.arguments[0]) };
}

test("the choices show as buttons, and picking one asks for a draft that says it", async () => {
  triageLeft({ options: [ACCEPT, DECLINE] });
  const { user, picks } = renderChoices();
  await user.click(await screen.findByRole("button", { name: "Yes, Thursday Works" }));
  assert.deepEqual(picks(), [{ text: ACCEPT.decision, kind: "accept" }]);
  // Read for the latest message, the one waiting on you.
  assert.deepEqual(fakeSupabase.callsTo("from:message_ai")[0].steps.find((s) => s.name === "eq")?.args, ["message_id", KITCHEN_MESSAGES.at(-1)!.id]);
});

test("nothing is offered once you wrote last", async () => {
  triageLeft({ options: [ACCEPT, DECLINE] });
  renderChoices(KITCHEN_MESSAGES.slice(0, 2));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(screen.queryByRole("button", { name: "Yes, Thursday Works" }), null);
  assert.equal(fakeSupabase.callsTo("from:message_ai").length, 0);
});

test("the buttons are off while a draft is being written", async () => {
  triageLeft({ options: [ACCEPT, DECLINE] });
  renderChoices(KITCHEN_MESSAGES, true);
  assert.equal(((await screen.findByRole("button", { name: "Not This Week" })) as HTMLButtonElement).disabled, true);
});

test("an availability question says whether the calendar is free then", async () => {
  triageLeft({ asked: localAt(1, 10), options: [ACCEPT, OTHER] });
  renderChoices();
  assert.ok(await screen.findByText(/^Your calendar is free on /));
});

test("Suggest Another Time offers free slots, one of which is picked as the other time; Back returns", async () => {
  triageLeft({ asked: localAt(1, 10), options: [ACCEPT, OTHER] });
  const { user, picks } = renderChoices();
  await screen.findByText(/^Your calendar is free on /);
  await user.click(screen.getByRole("button", { name: "Suggest Another Time" }));
  assert.equal(screen.queryByRole("button", { name: "Yes, Thursday Works" }), null);
  const slots = screen.getAllByRole("button").filter((b) => /, \d{2}:\d{2}$/.test(b.textContent ?? ""));
  assert.equal(slots.length, 3);
  await user.click(slots[0]);
  assert.equal(picks()[0].kind, "other_time");
  assert.match(picks()[0].text, /^I am not free on .*, but .* works for me\.$/);
  await user.click(screen.getByRole("button", { name: "Back" }));
  assert.ok(screen.getByRole("button", { name: "Yes, Thursday Works" }));
});

test("a plan with a date offers Add to Calendar, which opens New Event filled in", async () => {
  triageLeft({ options: [ACCEPT, DECLINE], plan: { title: "Site Visit", start: localAt(2, 9), end: localAt(2, 11), place: "12 Oak Lane" } });
  const { user } = renderChoices();
  await user.click(await screen.findByRole("button", { name: "Add to Calendar" }));
  const dialog = await screen.findByRole("dialog", { name: "New Event" });
  assert.ok(within(dialog).getByDisplayValue("Site Visit"));
  assert.ok(within(dialog).getByDisplayValue("12 Oak Lane"));
});

test("no plan, no Add to Calendar", async () => {
  triageLeft({ options: [ACCEPT, DECLINE] });
  renderChoices();
  await screen.findByRole("button", { name: "Yes, Thursday Works" });
  assert.equal(screen.queryByRole("button", { name: "Add to Calendar" }), null);
});

test("fewer than two choices is no choice, so nothing shows", async () => {
  triageLeft({ options: [ACCEPT] });
  renderChoices();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(screen.queryByRole("button"), null);
});
