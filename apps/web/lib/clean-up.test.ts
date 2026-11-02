// Tests for clean-up.ts: which senders Clean Up offers (unopened for 90 days) and the line under each.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanUpLine, cleanUpSenders } from "./clean-up";
import type { Contact, Thread } from "./types";

const NOW = new Date("2026-11-02T12:00:00Z");
const contacts: Record<string, Contact> = {
  c1: { id: "c1", name: "News", emails: ["a@acme.co"] } as Contact,
  c2: { id: "c2", name: "Shop", emails: ["b@shop.co"] } as Contact,
};
const thread = (id: string, contact: string, at: string, extra: Partial<Thread> = {}) =>
  ({ id, lastMessageAt: at, participantIds: [contact], accountId: "acc", isGroup: false, unread: true, subscription: true, junk: true, category: "newsletter", status: "inbox", ...extra }) as Thread;
const of = (id: string) => contacts[id];

test("a sender with only unopened mail older than 90 days is offered", () => {
  const rows = cleanUpSenders([thread("t1", "c1", "2026-06-01T00:00:00Z"), thread("t2", "c1", "2026-10-30T00:00:00Z")], of, NOW);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].threadIds, ["t1", "t2"]);
  assert.equal(rows[0].canUnsubscribe, true);
});

test("one opened conversation keeps the sender out", () => {
  const rows = cleanUpSenders([thread("t1", "c1", "2026-06-01T00:00:00Z"), thread("t2", "c1", "2026-07-01T00:00:00Z", { unread: false })], of, NOW);
  assert.equal(rows.length, 0);
});

test("recent unopened mail is not old enough yet", () => {
  assert.equal(cleanUpSenders([thread("t1", "c1", "2026-10-01T00:00:00Z")], of, NOW).length, 0);
});

test("people and ordinary mail are never offered, and the sender with most mail comes first", () => {
  const rows = cleanUpSenders(
    [
      thread("t1", "c1", "2026-05-01T00:00:00Z"),
      thread("t2", "c2", "2026-05-01T00:00:00Z"),
      thread("t3", "c2", "2026-05-02T00:00:00Z"),
      thread("t4", "c1", "2026-05-01T00:00:00Z", { subscription: false, junk: false, category: "personal" }),
    ],
    of,
    NOW,
  );
  assert.deepEqual(rows.map((r) => r.name), ["Shop", "News"]);
  assert.equal(rows[1].count, 1);
});

test("junk newsletters with no unsubscribe are offered for Mark as Junk only when not yet junk", () => {
  const rows = cleanUpSenders([thread("t1", "c1", "2026-05-01T00:00:00Z", { subscription: false })], of, NOW);
  assert.equal(rows[0].canUnsubscribe, false);
  assert.equal(rows[0].allJunk, true);
});

test("the line says how many and for how long", () => {
  assert.equal(cleanUpLine({ count: 1, since: "2026-05-01T00:00:00Z" }, NOW), "1 email, none opened in 185 days");
  assert.equal(cleanUpLine({ count: 3, since: "2026-10-30T00:00:00Z" }, NOW), "3 emails, none opened in 90 days");
});
