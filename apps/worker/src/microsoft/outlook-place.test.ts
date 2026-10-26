import assert from "node:assert/strict";
import { test } from "node:test";
import { foldDeltas, outlookMove, outlookThreadPlace, roleOf } from "./outlook-place";

const inbound = (folder: Parameters<typeof outlookThreadPlace>[0][number]["folder"]) => ({ folder, direction: "inbound" });
const outbound = (folder: Parameters<typeof outlookThreadPlace>[0][number]["folder"]) => ({ folder, direction: "outbound" });

test("works out where a conversation is in Outlook", () => {
  assert.equal(outlookThreadPlace([inbound("inbox"), outbound("sentitems")], true), "inbox");
  assert.equal(outlookThreadPlace([inbound("archive"), outbound("sentitems")], true), "archived");
  assert.equal(outlookThreadPlace([inbound("deleteditems"), outbound("sentitems")], true), "trash");
  assert.equal(outlookThreadPlace([inbound("junkemail"), inbound("deleteditems")], true), "spam");
  // Moved to a folder of your own, or deleted for good: archived.
  assert.equal(outlookThreadPlace([inbound(null), outbound("sentitems")], true), "archived");
  assert.equal(outlookThreadPlace([outbound("sentitems")], true), "archived");
  assert.equal(outlookThreadPlace([], true), "archived");
});

test("names each folder's role as IMAP would", () => {
  assert.equal(roleOf("inbox"), "inbox");
  assert.equal(roleOf("sentitems"), "sent");
  assert.equal(roleOf("archive"), "archive");
});

test("maps app actions to Outlook folder moves", () => {
  const archive = outlookMove("archive", true);
  assert.ok(archive && "from" in archive);
  assert.deepEqual(archive.from, ["inbox"]);
  assert.equal(archive.to(), "archive");

  const trash = outlookMove("trash", true);
  assert.ok(trash && "from" in trash);
  assert.deepEqual(trash.from, ["inbox", "archive", "junkemail"]);
  assert.equal(trash.to(), "deleteditems");
  assert.equal(trash.remember, true);

  // Undoing a delete sends mail back where it came from, or to the Inbox.
  const untrash = outlookMove("untrash", true);
  assert.ok(untrash && "from" in untrash);
  assert.deepEqual(untrash.from, ["deleteditems"]);
  assert.equal(untrash.to("archive"), "archive");
  assert.equal(untrash.to("inbox"), "inbox");
  assert.equal(untrash.to(), "inbox");

  const unspam = outlookMove("unspam", true);
  assert.ok(unspam && "from" in unspam);
  assert.deepEqual(unspam.from, ["junkemail"]);
  assert.equal(unspam.to(), "inbox");

  assert.deepEqual(outlookMove("archive", false), { missing: "archive" });
  assert.equal(outlookMove("read", true), null);
});

test("folds folder deltas into each message's state", () => {
  const { seen, left } = foldDeltas([
    {
      folder: "inbox",
      messages: [
        { id: "a", conversationId: "c1", isRead: false, receivedDateTime: "2026-10-01T09:00:00Z" },
        { id: "b", "@removed": { reason: "changed" } },
        { id: "c", "@removed": { reason: "deleted" } },
      ],
    },
    { folder: "archive", messages: [{ id: "b", conversationId: "c2", isRead: true }] },
  ]);
  assert.deepEqual(seen.get("a"), { folder: "inbox", conversationId: "c1", isRead: false, isDraft: false, receivedAt: "2026-10-01T09:00:00Z" });
  // Moved from the Inbox to Archive: present wins, whichever folder was read first.
  assert.equal(seen.get("b")?.folder, "archive");
  assert.equal(left.has("b"), false);
  assert.equal(left.get("c"), "inbox");

  const reversed = foldDeltas([
    { folder: "archive", messages: [{ id: "b", isRead: true }] },
    { folder: "inbox", messages: [{ id: "b", "@removed": { reason: "changed" } }] },
  ]);
  assert.equal(reversed.seen.get("b")?.folder, "archive");
  assert.equal(reversed.left.size, 0);
});
