// Tests for snippets.ts: ;shortcut expands on the space after it, with variables filled, and never early.

import { test } from "node:test";
import assert from "node:assert/strict";
import { expandSnippet, normaliseShortcut } from "./snippets";

const snippets = [{ shortcut: "thanks", body: "Thanks {first_name}, much appreciated." }, { shortcut: "addr", body: "12 Long Street" }];
const vars = { first_name: "Jane" };

test("normaliseShortcut drops the semicolon and odd characters", () => {
  assert.equal(normaliseShortcut(";Thanks Now!"), "thanksnow");
  assert.equal(normaliseShortcut("  ;;a-b_1 "), "a-b_1");
  assert.equal(normaliseShortcut("!!!"), "");
});

test("expands on the space after the shortcut and moves the caret past it", () => {
  const typed = "Hello ;thanks ";
  assert.deepEqual(expandSnippet(typed, typed.length, snippets, vars), { text: "Hello Thanks Jane, much appreciated. ", caret: 37 });
});

test("expands in the middle of text and on a line break", () => {
  const out = expandSnippet("Meet at ;addr\nsoon", 14, snippets, vars);
  assert.equal(out?.text, "Meet at 12 Long Street\nsoon");
  assert.equal(out?.caret, 23);
});

test("does nothing before the space, for an unknown shortcut, or when the semicolon is inside a word", () => {
  assert.equal(expandSnippet("Hello ;thanks", 13, snippets, vars), null);
  assert.equal(expandSnippet("Hello ;nope ", 12, snippets, vars), null);
  assert.equal(expandSnippet("a;thanks ", 9, snippets, vars), null);
  assert.equal(expandSnippet("Hello ", 6, snippets, vars), null);
});

test("an unfilled variable stays in the expanded text", () => {
  assert.equal(expandSnippet(";thanks ", 8, snippets, {})?.text, "Thanks {first_name}, much appreciated. ");
});
