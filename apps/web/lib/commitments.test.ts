// Pins down lib/commitments.ts: which promises the Summary lists and which the open conversation shows, the due wording,
// and how a Realtime change is patched into the list.

import assert from "node:assert/strict";
import test from "node:test";
import { applyCommitment, dayOf, daysBetween, dueText, isActive, promisesFor, promisesForSummary, removeCommitment, type Commitment } from "./commitments";

const now = new Date(2026, 10, 4, 10, 0, 0); // Wednesday 4 November 2026, local
const make = (id: string, owner: "me" | "them", dueOn: string | null, extra: Partial<Commitment> = {}): Commitment => ({ id, threadId: "t1", messageId: "m1", owner, text: `Promise ${id}`, dueOn, status: "open", snoozedUntil: null, ...extra });

test("days are counted between calendar days, across a month end", () => {
  assert.equal(daysBetween("2026-10-30", "2026-11-02"), 3);
  assert.equal(daysBetween("2026-11-04", "2026-11-04"), 0);
  assert.equal(dayOf(now), "2026-11-04");
});

test("the Summary lists your promises due within two days or late, and theirs only when late", () => {
  const list = [
    make("a", "me", "2026-11-03"), // late
    make("b", "me", "2026-11-06"), // two days: soon
    make("c", "me", "2026-11-07"), // three days: not yet
    make("d", "them", "2026-11-03"), // late
    make("e", "them", "2026-11-04"), // today: not late yet
    make("f", "me", null), // no day
  ];
  const { yours, theirs } = promisesForSummary(list, now);
  assert.deepEqual(yours.map((c) => c.id), ["a", "b"]);
  assert.deepEqual(theirs.map((c) => c.id), ["d"]);
});

test("a done promise, and one snoozed to a later time, stay off the Summary until it passes", () => {
  const later = new Date(now.getTime() + 3_600_000).toISOString();
  const earlier = new Date(now.getTime() - 3_600_000).toISOString();
  const list = [make("a", "me", "2026-11-01", { status: "done" }), make("b", "me", "2026-11-01", { snoozedUntil: later }), make("c", "me", "2026-11-01", { snoozedUntil: earlier })];
  assert.deepEqual(promisesForSummary(list, now).yours.map((c) => c.id), ["c"]);
  assert.equal(isActive(list[1], now.getTime()), false);
});

test("the strip in a conversation lists its open promises, yours first, undated last", () => {
  const list = [make("a", "them", "2026-11-05"), make("b", "me", null), make("c", "me", "2026-11-09"), make("d", "me", "2026-11-01", { threadId: "t2" }), make("e", "me", "2026-11-02", { status: "done" })];
  assert.deepEqual(promisesFor(list, "t1").map((c) => c.id), ["c", "b", "a"]);
});

test("due wording", () => {
  assert.equal(dueText({ dueOn: "2026-11-04" }, now), "Due Today");
  assert.equal(dueText({ dueOn: "2026-11-05" }, now), "Due Tomorrow");
  assert.equal(dueText({ dueOn: "2026-11-03" }, now), "1 Day Overdue");
  assert.equal(dueText({ dueOn: "2026-11-01" }, now), "3 Days Overdue");
  assert.equal(dueText({ dueOn: null }, now), "No Date");
  assert.match(dueText({ dueOn: "2026-11-13" }, now), /^Due Fri 13 Nov/);
});

test("a changed promise replaces its copy in place, a done one leaves, a new one goes in by due day", () => {
  const list = [make("a", "me", "2026-11-03"), make("b", "me", "2026-11-05"), make("n", "me", null)];
  assert.deepEqual(applyCommitment(list, make("b", "me", "2026-11-05", { snoozedUntil: "x" })).map((c) => [c.id, c.snoozedUntil]), [["a", null], ["b", "x"], ["n", null]]);
  assert.deepEqual(applyCommitment(list, make("a", "me", "2026-11-03", { status: "done" })).map((c) => c.id), ["b", "n"]);
  assert.deepEqual(applyCommitment(list, make("c", "them", "2026-11-04")).map((c) => c.id), ["a", "c", "b", "n"]);
  assert.deepEqual(applyCommitment(list, make("d", "them", null)).map((c) => c.id), ["a", "b", "n", "d"]);
  assert.deepEqual(applyCommitment(list, make("a", "me", "2026-11-09")).map((c) => c.id), ["b", "a", "n"]);
  assert.equal(applyCommitment(list, make("z", "me", null, { status: "done" })), list);
});

test("a deleted promise leaves, and an unknown id changes nothing", () => {
  const list = [make("a", "me", null)];
  assert.deepEqual(removeCommitment(list, "a"), []);
  assert.equal(removeCommitment(list, "b"), list);
});
