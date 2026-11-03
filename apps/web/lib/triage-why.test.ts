// Tests for lib/triage-why.ts: every fraud kind has its warning.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SUSPICIOUS_COPY } from "./triage-why";

test("every fraud kind the AI can flag has a warning", () => {
  for (const kind of ["payment_change", "phishing", "impersonation"]) assert.ok(SUSPICIOUS_COPY[kind].title);
});
