// Tests for ingest/imap-place.ts. Pin down how a conversation's place (inbox, archived, trash, spam) is worked out from
// its messages' folders and how app actions map to IMAP folder moves.

import assert from "node:assert/strict";
import { test } from "node:test";
import { imapMove, imapThreadPlace } from "./imap-place";

const paths = { archive: "Archive", trash: "Deleted Messages", junk: "Junk" };

test("works out where a conversation is on the server", () => {
  const inbound = (folder?: string) => ({ folder, direction: "inbound" });
  const outbound = (folder?: string) => ({ folder, direction: "outbound" });
  assert.equal(imapThreadPlace([inbound("INBOX"), outbound("Sent Messages")], paths), "inbox");
  assert.equal(imapThreadPlace([inbound("Archive"), outbound("Sent Messages")], paths), "archived");
  assert.equal(imapThreadPlace([inbound("Deleted Messages"), outbound("Sent Messages")], paths), "trash");
  assert.equal(imapThreadPlace([inbound("Junk"), inbound("Deleted Messages")], paths), "spam");
  assert.equal(imapThreadPlace([inbound("Junk"), inbound(undefined)], paths), "archived");
  assert.equal(imapThreadPlace([outbound("Deleted Messages")], paths), "trash");
  assert.equal(imapThreadPlace([], paths), "archived");
  // Without a Trash folder nothing counts as deleted.
  assert.equal(imapThreadPlace([inbound(undefined)], {}), "archived");
});

test("maps app actions to folder moves", () => {
  const trash = imapMove("trash", paths);
  assert.ok(trash && "from" in trash);
  assert.deepEqual(trash.from, ["INBOX", "Archive", "Junk"]);
  assert.equal(trash.to(), "Deleted Messages");
  assert.equal(trash.remember, true);

  const untrash = imapMove("untrash", paths);
  assert.ok(untrash && "from" in untrash);
  assert.deepEqual(untrash.from, ["Deleted Messages"]);
  assert.equal(untrash.to("Archive"), "Archive");
  assert.equal(untrash.to(), "INBOX");

  const spam = imapMove("spam", paths);
  assert.ok(spam && "from" in spam);
  assert.equal(spam.to(), "Junk");
  const unspam = imapMove("unspam", paths);
  assert.ok(unspam && "from" in unspam);
  assert.deepEqual(unspam.from, ["Junk"]);
  assert.equal(unspam.to("Archive"), "INBOX");

  assert.deepEqual(imapMove("trash", { archive: "Archive" }), { missing: "trash" });
  assert.deepEqual(imapMove("spam", {}), { missing: "junk" });
  assert.equal(imapMove("read", paths), null);
});
