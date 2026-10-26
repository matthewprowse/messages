import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_NAME,
  attendeesOf,
  conferenceFilter,
  entriesToSegments,
  eventForMeeting,
  isWorkspace,
  mapParticipants,
  meetReadProblem,
  meetingCodeOf,
  noTranscriptsLikely,
  participantName,
  transcriptReadiness,
  type MeetParticipant,
  type TranscriptEntry,
} from "./meet";

// Shaped like the Meet REST API's responses (conferenceRecords.participants.list, transcripts.entries.list).
const RECORD = "conferenceRecords/abc-123";
const participants: MeetParticipant[] = [
  { name: `${RECORD}/participants/p1`, signedinUser: { user: "users/111", displayName: "Thandi Nkosi" }, earliestStartTime: "2026-10-20T09:00:05Z" },
  { name: `${RECORD}/participants/p2`, signedinUser: { user: "users/222", displayName: "Pieter van Wyk" }, earliestStartTime: "2026-10-20T09:01:00Z" },
  { name: `${RECORD}/participants/p3`, anonymousUser: { displayName: "Guest Lerato" } },
  { name: `${RECORD}/participants/p4`, phoneUser: { displayName: "+27 82 *** **12" } },
];

test("entries become segments timed from the meeting's start, with speakers by participant", () => {
  const entries: TranscriptEntry[] = [
    { participant: `${RECORD}/participants/p2`, text: "Morning, can you hear me?", startTime: "2026-10-20T09:01:03.500Z", endTime: "2026-10-20T09:01:05Z" },
    { participant: `${RECORD}/participants/p1`, text: "Yes, loud and clear.", startTime: "2026-10-20T09:01:06Z", endTime: "2026-10-20T09:01:07Z" },
  ];
  const speakers = new Map([[`${RECORD}/participants/p1`, "Thandi Nkosi"], [`${RECORD}/participants/p2`, "Pieter van Wyk"]]);
  assert.deepEqual(entriesToSegments(entries, { startedAt: "2026-10-20T09:00:00Z", speakers }), [
    { speaker: "Pieter van Wyk", start_ms: 63_500, text: "Morning, can you hear me?" },
    { speaker: "Thandi Nkosi", start_ms: 66_000, text: "Yes, loud and clear." },
  ]);
});

test("entries are put in order, one speaker's run is joined, and blank ones are dropped", () => {
  const p1 = `${RECORD}/participants/p1`;
  const p2 = `${RECORD}/participants/p2`;
  const entries: TranscriptEntry[] = [
    { participant: p1, text: "  so the offer is   signed. ", startTime: "2026-10-20T09:00:12Z" },
    { participant: p1, text: "Right, let's start.", startTime: "2026-10-20T09:00:10Z" },
    { participant: p2, text: "   ", startTime: "2026-10-20T09:00:14Z" },
    { participant: p2, text: "Great.", startTime: "2026-10-20T09:00:15Z" },
    { participant: `${RECORD}/participants/gone`, text: "Hello?", startTime: "2026-10-20T09:00:20Z" },
  ];
  const speakers = new Map([[p1, "Thandi"], [p2, "Pieter"]]);
  assert.deepEqual(entriesToSegments(entries, { startedAt: "2026-10-20T09:00:00Z", speakers }), [
    { speaker: "Thandi", start_ms: 10_000, text: "Right, let's start. so the offer is signed." },
    { speaker: "Pieter", start_ms: 15_000, text: "Great." },
    { speaker: NO_NAME, start_ms: 20_000, text: "Hello?" },
  ]);
});

test("a long run by one speaker is split rather than made one huge segment", () => {
  const p1 = `${RECORD}/participants/p1`;
  const long = "word ".repeat(120).trim();
  const entries = [0, 1, 2].map((i) => ({ participant: p1, text: long, startTime: `2026-10-20T09:00:0${i}Z` }));
  const segments = entriesToSegments(entries, { startedAt: "2026-10-20T09:00:00Z", speakers: new Map([[p1, "Thandi"]]) });
  assert.equal(segments.length, 2);
  assert.equal(segments[1].start_ms, 2_000);
  assert.ok(segments.every((s) => s.speaker === "Thandi"));
});

test("an entry before the start or without a time never goes negative", () => {
  const segments = entriesToSegments(
    [{ participant: "x", text: "Early", startTime: "2026-10-20T08:59:59Z" }, { participant: "y", text: "No time" }],
    { startedAt: "2026-10-20T09:00:00Z", speakers: new Map([["x", "A"], ["y", "B"]]) },
  );
  assert.deepEqual(segments, [{ speaker: "A", start_ms: 0, text: "Early" }, { speaker: "B", start_ms: 0, text: "No time" }]);
});

test("participants are named by kind, with a fallback", () => {
  assert.equal(participantName(participants[0]), "Thandi Nkosi");
  assert.equal(participantName(participants[2]), "Guest Lerato");
  assert.equal(participantName(participants[3]), "+27 82 *** **12");
  assert.equal(participantName({ name: "n", signedinUser: { user: "users/9", displayName: " " } }), NO_NAME);
});

test("you are found by your Google ID and given your address", () => {
  const mapped = mapParticipants(participants, { selfUserId: "111", selfEmail: "Thandi@Firm.co.za", attendees: [] });
  assert.deepEqual(mapped[0], { key: `${RECORD}/participants/p1`, name: "Thandi Nkosi", address: "thandi@firm.co.za", isSelf: true });
  assert.ok(mapped.slice(1).every((m) => !m.isSelf));
});

test("other people get addresses by ID first, then by name on the invitation, guests and phones none", () => {
  const mapped = mapParticipants(
    [...participants, { name: `${RECORD}/participants/p5`, signedinUser: { user: "users/333", displayName: "Naledi Dube" } }],
    {
      selfUserId: "111",
      selfEmail: "thandi@firm.co.za",
      attendees: [
        { email: "thandi@firm.co.za", name: "Thandi Nkosi", self: true },
        { email: "naledi@client.co.za", name: "naledi  dube" },
        { email: "pieter@client.co.za", name: null },
      ],
      emailsByUser: new Map([["222", "Pieter.VW@client.co.za"]]),
    },
  );
  assert.deepEqual(
    mapped.map((m) => [m.name, m.address]),
    [
      ["Thandi Nkosi", "thandi@firm.co.za"],
      ["Pieter van Wyk", "pieter.vw@client.co.za"],
      ["Guest Lerato", null],
      ["+27 82 *** **12", null],
      ["Naledi Dube", "naledi@client.co.za"],
    ],
  );
});

test("one unmatched person and one unmatched guest are paired, but not when it is ambiguous", () => {
  const two: MeetParticipant[] = [participants[0], participants[1]];
  const attendees = [{ email: "thandi@firm.co.za", self: true }, { email: "pieter@client.co.za", name: "P. van Wyk" }];
  const paired = mapParticipants(two, { selfUserId: "111", selfEmail: "thandi@firm.co.za", attendees });
  assert.equal(paired[1].address, "pieter@client.co.za");

  const ambiguous = mapParticipants(two, {
    selfUserId: "111",
    selfEmail: "thandi@firm.co.za",
    attendees: [...attendees, { email: "someone@client.co.za" }],
  });
  assert.equal(ambiguous[1].address, null);
});

test("an address is never given to two people", () => {
  const mapped = mapParticipants(
    [participants[1], { name: "p9", signedinUser: { user: "users/999", displayName: "Pieter van Wyk" } }],
    { selfUserId: null, selfEmail: null, attendees: [{ email: "pieter@client.co.za", name: "Pieter van Wyk" }] },
  );
  assert.deepEqual(mapped.map((m) => m.address), ["pieter@client.co.za", null]);
});

test("a transcript is read once it has ended, waited for while it is written, and none means none", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  assert.equal(transcriptReadiness([{ name: "t", state: "FILE_GENERATED" }], "2026-10-20T11:00:00Z", now), "ready");
  assert.equal(transcriptReadiness([{ name: "t", state: "ENDED" }], "2026-10-20T11:00:00Z", now), "ready");
  assert.equal(transcriptReadiness([{ name: "t", state: "STARTED" }], "2026-10-20T11:00:00Z", now), "waiting");
  assert.equal(transcriptReadiness([], "2026-10-20T11:50:00Z", now), "waiting");
  assert.equal(transcriptReadiness([], "2026-10-20T10:00:00Z", now), "none");
  // Still "started" a day on: what there is gets read.
  assert.equal(transcriptReadiness([{ name: "t", state: "STARTED" }], "2026-10-18T11:00:00Z", now), "ready");
});

test("the calendar event is the one with the meeting's link nearest its start", () => {
  const events = [
    { id: "weekly-last", title: "Weekly", starts_at: "2026-10-13T09:00:00Z", conference_url: "https://meet.google.com/abc-mnop-xyz", attendees: [] },
    { id: "weekly-now", title: "Weekly", starts_at: "2026-10-20T09:00:00Z", conference_url: "https://meet.google.com/abc-mnop-xyz?authuser=0", attendees: [] },
    { id: "other", title: "Other", starts_at: "2026-10-20T09:00:00Z", conference_url: "https://meet.google.com/zzz-zzzz-zzz", attendees: [] },
  ];
  assert.equal(eventForMeeting(events, { meetingCode: "abc-mnop-xyz", startedAt: "2026-10-20T09:03:00Z" })?.id, "weekly-now");
  assert.equal(eventForMeeting(events, { meetingCode: "abc-mnop-xyz", startedAt: "2026-10-25T09:00:00Z" }), null);
  assert.equal(eventForMeeting(events, { meetingCode: null, startedAt: "2026-10-20T09:00:00Z" }), null);
});

test("meeting codes come from the space, or its link", () => {
  assert.equal(meetingCodeOf({ name: "spaces/x", meetingCode: "abc-mnop-xyz" }), "abc-mnop-xyz");
  assert.equal(meetingCodeOf({ name: "spaces/x", meetingUri: "https://meet.google.com/qrs-tuvw-xyz" }), "qrs-tuvw-xyz");
  assert.equal(meetingCodeOf(null), null);
});

test("stored attendees are read defensively", () => {
  assert.deepEqual(attendeesOf([{ email: "a@b.co", name: "A", self: true }, { name: "no email" }, null, "x"]), [{ email: "a@b.co", name: "A", self: true }]);
  assert.deepEqual(attendeesOf({}), []);
});

test("only ended meetings are asked for", () => {
  assert.equal(conferenceFilter("2026-10-20T09:00:00.000Z"), 'end_time>="2026-10-20T09:00:00.000Z"');
});

test("a Workspace account has a hosted domain; a personal one does not", () => {
  assert.equal(isWorkspace({ sub: "1", email: "thandi@firm.co.za", hd: "firm.co.za" }, null), true);
  assert.equal(isWorkspace({ sub: "1", email: "thandi@gmail.com" }, null), false);
  assert.equal(isWorkspace(null, "thandi@gmail.com"), false);
  assert.equal(isWorkspace(null, "thandi@firm.co.za"), true);
});

test("the no-transcripts hint needs a few meetings, all without one", () => {
  assert.equal(noTranscriptsLikely(["no_transcript", "no_transcript"]), false);
  assert.equal(noTranscriptsLikely(["no_transcript", "no_transcript", "no_transcript"]), true);
  assert.equal(noTranscriptsLikely(["no_transcript", "transcribed", "no_transcript", "no_transcript"]), false);
});

test("a 403 from Meet means the API is off or not granted", () => {
  assert.match(meetReadProblem(403, "PERMISSION_DENIED")!, /Meet REST API/);
  assert.match(meetReadProblem(403, "insufficientPermissions")!, /not granted/);
  assert.equal(meetReadProblem(500, null), null);
});
