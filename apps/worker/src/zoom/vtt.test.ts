// Tests for zoom/vtt.ts: parsing Zoom's WebVTT transcripts (speakers, cue joining, notes) and the Teams quirks it
// also accepts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseVtt, timestampMs } from "./vtt";

test("reads Zoom's transcript: numbered cues with Name: text", () => {
  const vtt = [
    "WEBVTT",
    "",
    "1",
    "00:00:01.050 --> 00:00:04.500",
    "Thandi Nkosi: Morning, can everyone hear me?",
    "",
    "2",
    "00:00:05.000 --> 00:00:07.250",
    "Pieter van Wyk: Loud and clear.",
    "",
  ].join("\n");
  assert.deepEqual(parseVtt(vtt), [
    { speaker: "Thandi Nkosi", start_ms: 1050, text: "Morning, can everyone hear me?" },
    { speaker: "Pieter van Wyk", start_ms: 5000, text: "Loud and clear." },
  ]);
});

test("joins a cue's lines, and cues in a row from one speaker", () => {
  const vtt = [
    "WEBVTT",
    "",
    "1",
    "00:01:00.000 --> 00:01:04.000",
    "Thandi Nkosi: The offer goes out",
    "on Friday.",
    "",
    "2",
    "00:01:04.100 --> 00:01:06.000",
    "Thandi Nkosi: Signed by both of us.",
    "",
    "3",
    "00:01:07.000 --> 00:01:08.000",
    "Pieter van Wyk: Great.",
  ].join("\n");
  assert.deepEqual(parseVtt(vtt), [
    { speaker: "Thandi Nkosi", start_ms: 60_000, text: "The offer goes out on Friday. Signed by both of us." },
    { speaker: "Pieter van Wyk", start_ms: 67_000, text: "Great." },
  ]);
});

test("keeps cues with no speaker apart, with speaker null", () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello there\n\n00:00:03.000 --> 00:00:04.000\nanyone?\n";
  assert.deepEqual(parseVtt(vtt), [
    { speaker: null, start_ms: 1000, text: "hello there" },
    { speaker: null, start_ms: 3000, text: "anyone?" },
  ]);
});

test("reads Teams' voice tags, CRLF line ends and a byte order mark", () => {
  const vtt = "﻿WEBVTT\r\n\r\nab12-1\r\n00:00:00.000 --> 00:00:02.000\r\n<v Thandi Nkosi>Shall we start?</v>\r\n\r\n00:00:02.500 --> 00:00:03.000\r\n<v.loud Pieter van Wyk>Yes &amp; quickly</v>\r\n";
  assert.deepEqual(parseVtt(vtt), [
    { speaker: "Thandi Nkosi", start_ms: 0, text: "Shall we start?" },
    { speaker: "Pieter van Wyk", start_ms: 2500, text: "Yes & quickly" },
  ]);
});

test("does not take a time or a link for a speaker", () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n10:30 works for me\n\n00:00:03.000 --> 00:00:04.000\nhttps://example.com/x is the link\n";
  assert.deepEqual(parseVtt(vtt).map((s) => s.speaker), [null, null]);
});

test("skips notes, styles and empty cues", () => {
  const vtt = "WEBVTT\n\nNOTE made by Zoom\n\nSTYLE\n::cue { color: red }\n\n00:00:01.000 --> 00:00:02.000\n\n\n00:00:02.000 --> 00:00:03.000\nThandi Nkosi: Right.\n";
  assert.deepEqual(parseVtt(vtt), [{ speaker: "Thandi Nkosi", start_ms: 2000, text: "Right." }]);
  assert.deepEqual(parseVtt(""), []);
});

test("reads short and long timestamps", () => {
  assert.equal(timestampMs("01:02.5"), 62_500);
  assert.equal(timestampMs("1:00:00.001"), 3_600_001);
  assert.equal(timestampMs("00:00:07,250"), 7250);
});
