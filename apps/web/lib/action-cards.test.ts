// Tests for action-cards.ts: stored proposals are checked again in the browser, a card can only attach a file from its own
// conversation, and Approve's inputs (meeting slots, task form, event start) come out right.

import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentIn, eventStart, meetingSlots, parseArgs, pendingFor, slotsText, taskFormFor, type ProposedAction } from "./action-cards";

test("a meeting keeps its title and a known length, else an hour", () => {
  assert.deepEqual(parseArgs("book_meeting", JSON.stringify({ title: " Catch up ", minutes: 30 })), { kind: "book_meeting", title: "Catch up", minutes: 30 });
  assert.equal((parseArgs("book_meeting", JSON.stringify({ title: "x", minutes: 7 })) as { minutes: number }).minutes, 60);
  assert.equal(parseArgs("book_meeting", JSON.stringify({ title: "  " })), null);
});

test("a task due date must be a date", () => {
  assert.deepEqual(parseArgs("create_task", JSON.stringify({ title: "Send quote", due: "2026-11-04" })), { kind: "create_task", title: "Send quote", due: "2026-11-04" });
  assert.equal((parseArgs("create_task", JSON.stringify({ title: "Send quote", due: "soon" })) as { due: string | null }).due, null);
});

test("files and templates need an id and a name; unknown kinds, bad JSON and shapes are refused", () => {
  assert.ok(parseArgs("attach_file", JSON.stringify({ attachment_id: "a1", name: "Quote.pdf" })));
  assert.equal(parseArgs("attach_file", JSON.stringify({ name: "Quote.pdf" })), null);
  assert.ok(parseArgs("use_template", JSON.stringify({ template_id: "t1", title: "Intro" })));
  assert.equal(parseArgs("use_template", JSON.stringify({ template_id: 5, title: "Intro" })), null);
  assert.equal(parseArgs("send_email", JSON.stringify({ title: "x" })), null);
  assert.equal(parseArgs("book_meeting", "not json"), null);
  assert.equal(parseArgs("book_meeting", null), null);
  assert.equal(parseArgs("book_meeting", "null"), null);
});

test("only a stored file from this conversation can be attached", () => {
  const msgs = [{ attachments: [{ id: "a1", name: "Quote.pdf", kind: "pdf" as const, size: "1 MB", path: "u/a1" }, { id: "a2", name: "Gone.pdf", kind: "pdf" as const, size: "1 MB", path: "u/a2", notKept: "deleted" as const }, { id: "a3", name: "None.pdf", kind: "pdf" as const, size: "1 MB" }] }, { attachments: undefined }];
  assert.equal(attachmentIn(msgs, "a1")?.name, "Quote.pdf");
  assert.equal(attachmentIn(msgs, "a2"), null);
  assert.equal(attachmentIn(msgs, "a3"), null);
  assert.equal(attachmentIn(msgs, "elsewhere"), null);
});

test("a meeting offers three free times and writes them into the reply", () => {
  const now = new Date(2026, 10, 2, 7, 0);
  const busy = [{ title: "Call", startsAt: new Date(2026, 10, 2, 8).toISOString(), endsAt: new Date(2026, 10, 2, 9).toISOString(), allDay: false }];
  const slots = meetingSlots(busy, 60, now);
  assert.equal(slots.length, 3);
  assert.ok(slots.every((s) => s.getHours() !== 8 || s.getDate() !== 2));
  assert.ok(slotsText(slots).startsWith("A few times that work for me:"));
  assert.deepEqual(eventStart(new Date(2026, 10, 4, 9, 5)), { day: "2026-11-04", time: "09:05" });
});

test("the task form carries the title and an all-day due date", () => {
  assert.deepEqual(taskFormFor({ title: " Send quote ", due: "2026-11-04" }, "acc"), { title: "Send quote", notes: "", accountId: "acc", date: "2026-11-04", time: "", priority: 0 });
  assert.equal(taskFormFor({ title: "x", due: null }, "acc").date, "");
});

test("only proposals still waiting for the draft in the box are shown", () => {
  const a = (id: string, draftId: string, status: ProposedAction["status"]): ProposedAction => ({ id, draftId, threadId: "t", status, args: { kind: "use_template", templateId: "t", title: "x" } });
  const all = [a("1", "d1", "proposed"), a("2", "d1", "dismissed"), a("3", "d0", "proposed")];
  assert.deepEqual(pendingFor(all, "d1").map((x) => x.id), ["1"]);
  assert.deepEqual(pendingFor(all, undefined), []);
});
