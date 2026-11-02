// Tests for the note made from a meeting summary.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canNoteMeeting, meetingNote, type MeetingForNote } from "./note-meeting";

const meeting = (over: Partial<MeetingForNote> = {}): MeetingForNote => ({
  title: "Kickoff", startedAt: "2026-11-02T08:00:00Z", summary: "We agreed the scope.", actionItems: ["Send plan", "Book venue"], calendarEventId: "ev1",
  people: [{ name: "Me", contactId: "me", isSelf: true }, { name: "Thandi", contactId: "c1", isSelf: false }, { name: "Sipho", contactId: "c1", isSelf: false }, { name: "Guest", contactId: null, isSelf: false }],
  ...over,
});

test("the summary and action items become an editable note", () => {
  const n = meetingNote(meeting(), "2 Nov 2026");
  assert.equal(n.title, "Kickoff");
  assert.ok(n.body.startsWith("2 Nov 2026 with Thandi, Sipho, Guest"));
  assert.ok(n.body.includes("## Summary\n\nWe agreed the scope."));
  assert.ok(n.body.includes("- [ ] Send plan\n- [ ] Book venue"));
});

test("it links the event and each attendee contact once, never yourself", () => {
  assert.deepEqual(meetingNote(meeting(), "x").links, [{ kind: "event", id: "ev1" }, { kind: "contact", id: "c1" }]);
});

test("a meeting with no event or title still makes a note", () => {
  const n = meetingNote(meeting({ title: " ", calendarEventId: null, summary: null }), "x");
  assert.equal(n.title, "Meeting");
  assert.ok(!n.body.includes("## Summary"));
  assert.ok(!n.links.some((l) => l.kind === "event"));
});

test("a note can be made only when there is a summary or action items", () => {
  assert.equal(canNoteMeeting({ summary: null, actionItems: [] }), false);
  assert.equal(canNoteMeeting({ summary: "  ", actionItems: [] }), false);
  assert.equal(canNoteMeeting({ summary: null, actionItems: ["x"] }), true);
  assert.equal(canNoteMeeting({ summary: "Yes", actionItems: [] }), true);
});
