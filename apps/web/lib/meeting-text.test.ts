// Tests for meeting-text.ts: reading stored action items and transcripts, meeting length, and searching and
// highlighting a transcript.

import { test } from "node:test";
import assert from "node:assert/strict";
import { hasTranscript, highlight, meetingLength, meetingsAmong, parseActions, parseTranscript, searchTranscript, segmentTime } from "./meeting-text";

test("stored action items read back as a list of strings", () => {
  assert.deepEqual(parseActions('["Send the offer by Friday", " ", 3, "Book a follow-up "]'), ["Send the offer by Friday", "Book a follow-up"]);
  assert.deepEqual(parseActions("not json"), []);
  assert.deepEqual(parseActions('{"a": 1}'), []);
  assert.deepEqual(parseActions(null), []);
});

test("stored transcripts read back as segments", () => {
  const stored = JSON.stringify([
    { speaker: " Sarah Lee ", start_ms: 1500, text: " Morning. " },
    { speaker: "Tom", start_ms: -5, text: "Hi." },
    { speaker: "Tom", start_ms: 9000, text: "" },
    "junk",
    { text: "No speaker" },
  ]);
  assert.deepEqual(parseTranscript(stored), [
    { speaker: "Sarah Lee", startMs: 1500, text: "Morning." },
    { speaker: "Tom", startMs: 0, text: "Hi." },
    { speaker: "", startMs: 0, text: "No speaker" },
  ]);
  assert.deepEqual(parseTranscript("Plain words"), [{ speaker: "", startMs: 0, text: "Plain words" }]);
  assert.deepEqual(parseTranscript(""), []);
  assert.deepEqual(parseTranscript(null), []);
});

test("a meeting's length", () => {
  const start = "2026-10-27T08:00:00Z";
  assert.equal(meetingLength(start, "2026-10-27T08:45:00Z"), "45 min");
  assert.equal(meetingLength(start, "2026-10-27T09:05:00Z"), "1 hr 5 min");
  assert.equal(meetingLength(start, "2026-10-27T10:00:00Z"), "2 hr");
  assert.equal(meetingLength(start, "2026-10-27T08:00:20Z"), "Under a minute");
  assert.equal(meetingLength(start, null), null);
  assert.equal(meetingLength(start, "2026-10-27T07:00:00Z"), null);
});

test("segment times", () => {
  assert.equal(segmentTime(0), "0:00");
  assert.equal(segmentTime(65_400), "1:05");
  assert.equal(segmentTime(3_725_000), "1:02:05");
});

test("search finds turns with every word, in what was said or who said it", () => {
  const segments = [
    { speaker: "Sarah Lee", startMs: 0, text: "Can you send the offer by Friday?" },
    { speaker: "Tom", startMs: 4000, text: "The offer is ready." },
    { speaker: "Tom", startMs: 8000, text: "See you Friday." },
  ];
  assert.equal(searchTranscript(segments, "").length, 3);
  assert.deepEqual(searchTranscript(segments, "OFFER").map((s) => s.startMs), [0, 4000]);
  assert.deepEqual(searchTranscript(segments, "offer friday").map((s) => s.startMs), [0]);
  assert.deepEqual(searchTranscript(segments, "tom friday").map((s) => s.startMs), [8000]);
  assert.deepEqual(searchTranscript(segments, "invoice"), []);
});

test("highlight marks the words searched for, keeping their case", () => {
  assert.deepEqual(highlight("Send the Offer, offer it", "offer"), [
    { text: "Send the ", hit: false },
    { text: "Offer", hit: true },
    { text: ", ", hit: false },
    { text: "offer", hit: true },
    { text: " it", hit: false },
  ]);
  assert.deepEqual(highlight("abc", " "), [{ text: "abc", hit: false }]);
  assert.deepEqual(highlight("aaa", "aa a"), [{ text: "aaa", hit: true }]);
});

test("which meetings sit among the loaded messages", () => {
  const meetings = [{ startedAt: "2026-10-20T08:00:00Z" }, { startedAt: "2026-10-10T08:00:00Z" }, { startedAt: "2026-10-25T08:00:00Z" }];
  assert.deepEqual(meetingsAmong(meetings, "2026-10-15T00:00:00Z", false).map((m) => m.startedAt), ["2026-10-20T08:00:00Z", "2026-10-25T08:00:00Z"]);
  assert.equal(meetingsAmong(meetings, "2026-10-15T00:00:00Z", true).length, 3);
  assert.deepEqual(meetingsAmong(meetings, undefined, true), []);
});

test("which meetings have a transcript to open", () => {
  assert.equal(hasTranscript({ status: "summarised", transcriptSource: "recording" }), true);
  assert.equal(hasTranscript({ status: "transcribed", transcriptSource: "provider" }), true);
  assert.equal(hasTranscript({ status: "waiting", transcriptSource: "recording" }), false);
  assert.equal(hasTranscript({ status: "no_transcript", transcriptSource: null }), false);
  assert.equal(hasTranscript({ status: "failed", transcriptSource: "provider" }), true);
  assert.equal(hasTranscript({ status: "failed", transcriptSource: "recording" }), false);
});
