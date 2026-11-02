// Tests for undo.ts: the effects an automation run recorded are read defensively, a contact is deleted only when the run made
// them and nothing else touched them, and the confirmation sentence says what was really removed.

import assert from "node:assert/strict";
import { test } from "node:test";
import { deletable, readEffects, undoneText, type Activity } from "./undo";

const quiet: Activity = { otherThreads: 0, otherTasks: 0, otherRuns: 0, otherDrafts: 0, messages: 0 };

test("effects are read from the stored JSON and anything malformed is dropped", () => {
  const e = readEffects({ contact_created: true, linked: true, task_update_id: "t1", draft_id: 7, identity_ids: ["a", 3], thread_before: { priority: "normal", junk: true, needs_reply: "x" } });
  assert.equal(e.contact_created, true);
  assert.equal(e.linked, true);
  assert.equal(e.task_update_id, "t1");
  assert.equal(e.draft_id, undefined);
  assert.deepEqual(e.identity_ids, ["a"]);
  assert.deepEqual(e.thread_before, { priority: "normal", junk: true, needs_reply: null });
  assert.deepEqual(readEffects(null), {});
  assert.deepEqual(readEffects([1]), {});
});

test("a contact the run made is deleted only when nothing else has happened to them", () => {
  const made = readEffects({ contact_created: true });
  assert.equal(deletable(made, quiet), true);
  for (const busy of [{ otherThreads: 1 }, { otherTasks: 1 }, { otherRuns: 1 }, { otherDrafts: 1 }, { messages: 1 }]) assert.equal(deletable(made, { ...quiet, ...busy }), false);
});

test("a repeat enquirer's existing contact is never deleted", () => {
  assert.equal(deletable(readEffects({ contact_created: false, set_lead: true }), quiet), false);
});

test("the confirmation names exactly what was removed", () => {
  const none = { contactDeleted: false, leadRemoved: false, taskRemoved: false, draftRemoved: false, urgentRestored: false };
  assert.equal(undoneText(none), "Undone. There was nothing left to remove.");
  assert.equal(undoneText({ ...none, contactDeleted: true, taskRemoved: true, draftRemoved: true }), "Undone. Removed the contact, the task and the draft.");
  assert.equal(undoneText({ ...none, leadRemoved: true }), "Undone. Removed the Lead mark.");
});
