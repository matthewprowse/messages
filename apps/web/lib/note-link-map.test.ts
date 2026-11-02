// Tests for note link rows, labels and page paths.
import assert from "node:assert/strict";
import { test } from "node:test";
import { captureTitle, linkHref, linkInsert, linkKey, targetOfPath, targetOfRow, threadLabel, uniqueTargets } from "./note-link-map";

test("a link becomes a row with exactly one target column", () => {
  assert.deepEqual(linkInsert("n", { kind: "contact", id: "c" }), { note_id: "n", contact_id: "c" });
  assert.deepEqual(linkInsert("n", { kind: "thread", id: "t" }), { note_id: "n", thread_id: "t" });
  assert.deepEqual(linkInsert("n", { kind: "event", id: "e" }), { note_id: "n", event_id: "e" });
});

test("a row maps back to its target", () => {
  assert.deepEqual(targetOfRow({ contact_id: null, thread_id: "t", event_id: null }), { kind: "thread", id: "t" });
  assert.deepEqual(targetOfRow({ contact_id: "c", thread_id: null, event_id: null }), { kind: "contact", id: "c" });
  assert.equal(targetOfRow({ contact_id: null, thread_id: null, event_id: null }), null);
});

test("repeated targets are dropped but different kinds with one id are kept", () => {
  const out = uniqueTargets([{ kind: "contact", id: "a" }, { kind: "contact", id: "a" }, { kind: "thread", id: "a" }]);
  assert.deepEqual(out.map(linkKey), ["contact:a", "thread:a"]);
});

test("links open the right page", () => {
  assert.equal(linkHref({ kind: "contact", id: "c" }), "/contacts/c");
  assert.equal(linkHref({ kind: "thread", id: "t" }), "/inbox/t");
  assert.equal(linkHref({ kind: "event", id: "e" }), "/calendar");
});

test("a conversation is named by group, subject, person or number", () => {
  const nameOf = (id: string) => (id === "p1" ? "Thandi" : undefined);
  assert.equal(threadLabel({ isGroup: true, groupName: "Site Team", subject: "x", participantIds: ["p1"] }, nameOf), "Site Team");
  assert.equal(threadLabel({ subject: " Quote ", participantIds: ["p1"] }, nameOf), "Quote");
  assert.equal(threadLabel({ participantIds: ["p0", "p1"] }, nameOf), "Thandi");
  assert.equal(threadLabel({ fallbackName: "+27 82 000 0000", participantIds: [] }, nameOf), "+27 82 000 0000");
  assert.equal(threadLabel({ participantIds: [] }, nameOf), "Conversation");
});

test("a conversation or contact page says what a note started there is about", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  assert.deepEqual(targetOfPath(`/inbox/${id}`), { kind: "thread", id });
  assert.deepEqual(targetOfPath(`/contacts/${id}/`), { kind: "contact", id });
  assert.equal(targetOfPath("/contacts/companies"), null);
  assert.equal(targetOfPath("/notes"), null);
});

test("a captured note takes the subject as its title, else the label", () => {
  assert.equal(captureTitle({ subject: " Invoice 12 " }, "Thandi"), "Invoice 12");
  assert.equal(captureTitle({}, "Thandi"), "Thandi");
  assert.equal(captureTitle(undefined, "Thandi"), "Thandi");
});
