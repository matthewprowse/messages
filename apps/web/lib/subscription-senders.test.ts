// Tests for subscription-senders.ts: grouping subscriptions by company, and a row's status across its addresses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { canPick, groupSenders, rowStatus } from "./subscription-senders";
import type { Contact, Thread, Unsubscribe } from "./types";

const thread = (id: string, at: string, contactId: string, accountId = "acc") => ({ id, lastMessageAt: at, participantIds: [contactId], accountId, isGroup: false }) as Thread;
const contacts: Record<string, Contact> = {
  c1: { id: "c1", name: "News", emails: ["a@acme.co"], organization: { id: "o1", name: "Acme" } } as Contact,
  c2: { id: "c2", name: "Promo", emails: ["b@acme.co"], organization: { id: "o1", name: "Acme" } } as Contact,
  c3: { id: "c3", name: "Sam", emails: ["sam@home.co"] } as Contact,
};
const status = (s: Unsubscribe["status"]) => ({ id: s, accountId: "acc", sender: "x", status: s }) as Unsubscribe;

test("addresses of one company share a row, newest first, and personal senders stand alone", () => {
  const rows = groupSenders(
    [thread("t1", "2026-01-01", "c1"), thread("t2", "2026-01-03", "c2"), thread("t3", "2026-01-02", "c3")],
    (id) => contacts[id],
  );
  assert.deepEqual(rows.map((r) => r.name), ["Acme", "Sam"]);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].addresses.length, 2);
  assert.equal(rows[0].latest.id, "t2");
});

test("conversations with no account or no address are left out", () => {
  const rows = groupSenders([thread("t1", "2026-01-01", "c1", ""), thread("t2", "2026-01-01", "missing")], (id) => contacts[id]);
  assert.equal(rows.length, 0);
});

test("a sender on its way or done cannot be picked again", () => {
  assert.ok(canPick(undefined));
  assert.ok(canPick(status("failed")));
  assert.ok(canPick(status("manual")));
  assert.ok(!canPick(status("queued")));
  assert.ok(!canPick(status("done")));
});

test("a row reports on its way first, then manual, failed, and done only once every address is", () => {
  assert.equal(rowStatus([status("done"), status("working")])?.status, "working");
  assert.equal(rowStatus([status("failed"), status("manual")])?.status, "manual");
  assert.equal(rowStatus([status("done"), status("failed")])?.status, "failed");
  assert.equal(rowStatus([status("done"), status("done")])?.status, "done");
  assert.equal(rowStatus([status("done"), undefined]), undefined);
});
