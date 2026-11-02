// Tests for packages/email-text/src/event-notes.ts: HTML notes become text, plain notes stay as written, and the cut
// never lands inside a tag.

import assert from "node:assert/strict";
import test from "node:test";
import { eventNotes } from "./event-notes";

test("html notes lose their tags and keep line breaks and link addresses", () => {
  const text = eventNotes('Agenda:<br>1. Budget<br><b>Join</b> <a href="https://zoom.us/j/123">https://zoom.us/j/123</a>')!;
  assert.ok(!/[<>]/.test(text));
  assert.ok(text.includes("Agenda:"));
  assert.ok(text.includes("https://zoom.us/j/123"));
  assert.ok(text.split("\n").length >= 2);
});

test("plain notes stay as written, including angle brackets that are not tags", () => {
  assert.equal(eventNotes("Call <Sarah> about the quote"), "Call <Sarah> about the quote");
  assert.equal(eventNotes("Line one\r\nLine two"), "Line one\nLine two");
});

test("entities in a note are decoded", () => {
  assert.equal(eventNotes("Fish &amp; chips&nbsp;night"), "Fish & chips night");
});

test("nothing left means null", () => {
  assert.equal(eventNotes(null), null);
  assert.equal(eventNotes("   "), null);
  assert.equal(eventNotes("<br><br>"), null);
});

test("the cut is made after the markup is removed", () => {
  const html = `<p>${"a".repeat(20)}</p><p>${"b".repeat(20)}</p>`;
  const text = eventNotes(html, 25)!;
  assert.ok(text.length <= 25);
  assert.ok(!text.includes("<"));
});
