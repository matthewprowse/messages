// Tests for runtime/calendar-problem.ts: which calendar accounts can take queued work, and the wording when one cannot.

import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarAccountProblem } from "./calendar-problem";

const acct = (provider: string, status = "connected") => ({ id: "a", provider, status });

test("Google, Outlook and iCloud calendars in good standing take every kind of work", () => {
  for (const verb of ["added to", "deleted from", "changed in"] as const) {
    assert.equal(calendarAccountProblem(acct("google_calendar"), verb), null);
    assert.equal(calendarAccountProblem(acct("outlook_calendar"), verb), null);
    assert.equal(calendarAccountProblem(acct("icloud_calendar"), verb), null);
  }
});

test("a calendar that is not Google, Outlook or iCloud takes none", () => {
  assert.match(calendarAccountProblem(acct("gmail"), "added to")!, /only be added to a Google, Outlook or iCloud Calendar/);
});

test("a broken account names how to reconnect that provider", () => {
  assert.match(calendarAccountProblem(acct("icloud_calendar", "error"), "added to")!, /Reconnect iCloud Calendar in Settings, Accounts/);
  assert.match(calendarAccountProblem(acct("outlook_calendar", "disconnected"), "changed in")!, /Reconnect Outlook Calendar in Settings, Accounts/);
  assert.match(calendarAccountProblem(acct("google_calendar", "error"), "deleted from")!, /Reconnect Google/);
});
