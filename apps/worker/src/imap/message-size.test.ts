// Tests for imap/message-size.ts: sizes split into ordered runs of small and too-large mail, and a too-large message
// becomes a plain note that keeps the sender, subject and threading headers.

import test from "node:test";
import assert from "node:assert/strict";
import { parseEmail } from "../ingest/normalize-email";
import { OVERSIZE_NOTE, oversizeSource, sizeRuns } from "./message-size";

test("sizes become runs in UID order, a missing size counting as small", () => {
  assert.deepEqual(sizeRuns([{ uid: 5, size: 10 }, { uid: 1, size: 10 }, { uid: 3, size: 999 }, { uid: 4 }, { uid: 2, size: 10 }], 100), [
    { big: false, uids: [1, 2] },
    { big: true, uids: [3] },
    { big: false, uids: [4, 5] },
  ]);
  assert.deepEqual(sizeRuns([]), []);
});

test("a too-large message keeps its headers and gets the note as a plain body", async () => {
  const headers = Buffer.from([
    "From: Thandi <thandi@example.com>",
    "To: me@example.com",
    "Subject: Plans",
    "Message-ID: <m1@example.com>",
    "In-Reply-To: <m0@example.com>",
    "Date: Mon, 2 Nov 2026 10:00:00 +0000",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed;",
    " boundary=\"abc\"",
    "Content-Transfer-Encoding: 7bit",
    "",
    "",
  ].join("\r\n"));
  const raw = oversizeSource(headers);
  assert.ok(!/boundary/.test(raw.toString()), "the multipart header and its folded line are gone");
  const mail = await parseEmail(raw, "x");
  assert.equal(mail.subject, "Plans");
  assert.equal(mail.text?.trim(), OVERSIZE_NOTE);
  assert.equal(mail.attachments.length, 0);
});
