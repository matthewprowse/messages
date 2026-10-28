// Tests for teams/vtt.ts: parsing Teams' WebVTT transcripts (timestamps, speakers) and joining several
// transcripts of one meeting.

import assert from "node:assert/strict";
import { test } from "node:test";
import { joinTranscripts, parseVtt, vttTime } from "./vtt";

test("reads WebVTT times in every form Teams writes", () => {
  assert.equal(vttTime("00:00:00.000"), 0);
  assert.equal(vttTime("01:02:03.456"), 3_723_456);
  assert.equal(vttTime("02:03.456"), 123_456);
  assert.equal(vttTime("0:0:3.15"), 3_150);
  assert.equal(vttTime("0:0:3.5"), 3_500);
  assert.equal(vttTime("00:00:07,250"), 7_250);
  assert.equal(vttTime("00:00:07"), 7_000);
  assert.equal(vttTime("10:00:00.000"), 36_000_000);
  assert.equal(vttTime("soon"), null);
  assert.equal(vttTime("00:00:xx.000"), null);
});

test("a Teams transcript becomes speaker turns", () => {
  const vtt = [
    "WEBVTT",
    "",
    "4d2b3f21-1c1e-4f5a-9d1b-6f8e6d0c2a11/12-0",
    "00:00:03.150 --> 00:00:05.790",
    "<v Adele Vance>Good morning, everyone.</v>",
    "",
    "4d2b3f21-1c1e-4f5a-9d1b-6f8e6d0c2a11/13-0",
    "00:00:05.790 --> 00:00:08.000",
    "<v Adele Vance>Shall we start with the offer?</v>",
    "",
    "4d2b3f21-1c1e-4f5a-9d1b-6f8e6d0c2a11/14-0",
    "00:00:08.500 --> 00:00:10.000",
    "<v Thabo Nkosi>Yes, please.</v>",
    "",
    "4d2b3f21-1c1e-4f5a-9d1b-6f8e6d0c2a11/15-0",
    "00:00:10.000 --> 00:00:12.000",
    "<v Adele Vance>Great.</v>",
    "",
  ].join("\n");
  assert.deepEqual(parseVtt(vtt), [
    { speaker: "Adele Vance", start_ms: 3_150, text: "Good morning, everyone. Shall we start with the offer?" },
    { speaker: "Thabo Nkosi", start_ms: 8_500, text: "Yes, please." },
    { speaker: "Adele Vance", start_ms: 10_000, text: "Great." },
  ]);
});

test("a cue over several lines is one piece of text", () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Lerato Dlamini>The transfer is booked\nfor Friday at ten.</v>\n";
  assert.deepEqual(parseVtt(vtt), [{ speaker: "Lerato Dlamini", start_ms: 1_000, text: "The transfer is booked for Friday at ten." }]);
});

test("a voice tag may open on one line and close on another, or not close at all", () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Sam>First line\nsecond line\n\n00:00:02.000 --> 00:00:03.000\n<v.loud Jo Smith>Shouting\n";
  assert.deepEqual(parseVtt(vtt), [
    { speaker: "Sam", start_ms: 1_000, text: "First line second line" },
    { speaker: "Jo Smith", start_ms: 2_000, text: "Shouting" },
  ]);
});

test("cues without a speaker keep their words with no name", () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello there.\n\n00:00:02.000 --> 00:00:03.000\nStill nobody.\n\n00:00:04.000 --> 00:00:05.000\n<v Ana>Hi.</v>\n";
  assert.deepEqual(parseVtt(vtt), [
    { speaker: null, start_ms: 1_000, text: "Hello there. Still nobody." },
    { speaker: "Ana", start_ms: 4_000, text: "Hi." },
  ]);
});

test("an empty voice tag counts as no speaker", () => {
  assert.deepEqual(parseVtt("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v >Who said that?</v>\n"), [
    { speaker: null, start_ms: 1_000, text: "Who said that?" },
  ]);
});

test("two voices in one cue are two segments", () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Ana>Are you there?</v>\n<v Ben>Yes.</v>\n";
  assert.deepEqual(parseVtt(vtt), [
    { speaker: "Ana", start_ms: 1_000, text: "Are you there?" },
    { speaker: "Ben", start_ms: 1_000, text: "Yes." },
  ]);
});

test("Windows line endings, a byte order mark, notes, styles and cue settings are handled", () => {
  const vtt = [
    "﻿WEBVTT - Teams transcript",
    "",
    "NOTE This is a comment",
    "that runs over two lines --> and has an arrow",
    "",
    "STYLE",
    "::cue { color: white }",
    "",
    "00:00:01.000 --> 00:00:02.000 align:start position:0%",
    "<v Mpho>Okay.</v>",
    "",
  ].join("\r\n");
  assert.deepEqual(parseVtt(vtt), [{ speaker: "Mpho", start_ms: 1_000, text: "Okay." }]);
});

test("entities are decoded and other tags dropped", () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v O&apos;Brien &amp; Co>R&amp;D costs &lt; R5&nbsp;000, <i>roughly</i> <00:00:01.500><c.yellow>fine</c> &#x1F44D;</v>\n";
  assert.deepEqual(parseVtt(vtt), [{ speaker: "O'Brien & Co", start_ms: 1_000, text: "R&D costs < R5 000, roughly fine \u{1F44D}" }]);
});

test("a cue straight after the header, without a blank line, still counts", () => {
  assert.deepEqual(parseVtt("WEBVTT\n00:00:00.500 --> 00:00:01.000\n<v Ana>Hi</v>"), [{ speaker: "Ana", start_ms: 500, text: "Hi" }]);
});

test("broken cues and empty text are skipped", () => {
  const vtt = "WEBVTT\n\nnot a time --> either\n<v Ana>Lost</v>\n\n00:00:02.000 --> 00:00:03.000\n<v Ana></v>\n\n00:00:03.000 --> 00:00:04.000\n<v Ana>Kept</v>\n";
  assert.deepEqual(parseVtt(vtt), [{ speaker: "Ana", start_ms: 3_000, text: "Kept" }]);
  assert.deepEqual(parseVtt(""), []);
  assert.deepEqual(parseVtt("WEBVTT\n"), []);
});

test("cues out of order are put in order", () => {
  const vtt = "WEBVTT\n\n00:00:05.000 --> 00:00:06.000\n<v Ben>Second</v>\n\n00:00:01.000 --> 00:00:02.000\n<v Ana>First</v>\n";
  assert.deepEqual(parseVtt(vtt).map((s) => s.text), ["First", "Second"]);
});

test("transcripts of one meeting join in order, each moved by when it began", () => {
  const joined = joinTranscripts([
    { startedAt: 1_000_000 + 600_000, segments: [{ speaker: "Ana", start_ms: 2_000, text: "Back again." }] },
    { startedAt: 1_000_000, segments: [{ speaker: "Ben", start_ms: 0, text: "Starting." }] },
  ]);
  assert.deepEqual(joined, [
    { speaker: "Ben", start_ms: 0, text: "Starting." },
    { speaker: "Ana", start_ms: 602_000, text: "Back again." },
  ]);
  assert.deepEqual(joinTranscripts([]), []);
});
