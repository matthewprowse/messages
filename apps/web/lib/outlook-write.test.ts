// Tests for outlook-write.ts: recognising the worker's "not allowed to change Outlook Calendar" refusal.

import assert from "node:assert/strict";
import { test } from "node:test";
import { needsOutlookWrite } from "./outlook-write";

test("the worker's refusal to change Outlook Calendar is recognised, other failures are not", () => {
  assert.ok(needsOutlookWrite("Outlook Calendar has not been allowed to make changes yet. Allow editing, then try again."));
  assert.ok(!needsOutlookWrite("Outlook Calendar is busy. Try again in a minute."));
  assert.ok(!needsOutlookWrite("Reconnect Google in Settings, Connected Accounts, to allow creating events."));
  assert.ok(!needsOutlookWrite(null));
});
