// Tests for imap/errors.ts: which failures come from the IMAP side, and the sentences a failed send or action shows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { actionFailureReason, isImapError, maybeSent, sendFailureReason } from "./errors";

const service = { name: "iCloud Mail", password: "app-specific password", object: "iCloud Mail", trashName: "Deleted Messages" };

test("a NO or BAD reply and a parser error are IMAP failures; a plain error is not", () => {
  assert.equal(isImapError({ responseStatus: "NO" }), true);
  assert.equal(isImapError({ code: "ParserError123" }), true);
  assert.equal(isImapError(new Error("db down")), false);
  assert.equal(isImapError(null), false);
});

test("a timeout with no server reply may have been sent; a refused reply was not", () => {
  assert.equal(maybeSent({ code: "ETIMEDOUT" }), true);
  assert.equal(maybeSent({ command: "DATA" }), true);
  assert.equal(maybeSent({ code: "ETIMEDOUT", responseCode: 554 }), false);
  assert.equal(maybeSent({ code: "EAUTH" }), false);
});

test("a send failure says too large, rejected sign-in, refused address, maybe sent, or try again", () => {
  assert.match(sendFailureReason({ responseCode: 552 }, "reply", service), /too large/);
  assert.match(sendFailureReason({ code: "EAUTH" }, "email", service), /rejected the app-specific password/);
  assert.match(sendFailureReason({ code: "EENVELOPE" }, "email", service), /From address or a recipient/);
  assert.match(sendFailureReason({ code: "ESOCKET" }, "reply", service), /may have been sent/);
  assert.equal(sendFailureReason({ responseCode: 550 }, "reply", service), "The reply could not be sent. Try again.");
});

test("an action failure names the missing folder, else says it will match on the next change", () => {
  assert.equal(actionFailureReason("NO_ARCHIVE", service), "iCloud Mail has no Archive folder.");
  assert.equal(actionFailureReason("NO_TRASH", service), "iCloud Mail has no Deleted Messages folder.");
  assert.equal(actionFailureReason("NO_JUNK", service), "iCloud Mail has no Junk folder.");
  assert.match(actionFailureReason(undefined, service), /will match on the next change/);
});
