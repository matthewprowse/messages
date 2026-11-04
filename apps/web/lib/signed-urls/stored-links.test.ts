// Tests for stored-links.ts: the signed link cache read back only for the user who stored it, only while each link
// has enough time left, and written capped to the newest links.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Entry } from "./cache-rules";
import { readStoredLinks, storedLinksForm } from "./stored-links";

const entry = (value: string | null | undefined, expires: number): Entry => ({ url: Promise.resolve(value ?? null), expires, value });

test("links written for a user read back for that user", () => {
  const raw = storedLinksForm([["b\np", entry("https://x/1", 100_000)]], "u1", 0, 10_000, 10);
  assert.deepEqual(readStoredLinks(raw, "u1", 0, 10_000), [["b\np", "https://x/1", 100_000]]);
});

test("another user's links are never read back", () => {
  const raw = storedLinksForm([["b\np", entry("https://x/1", 100_000)]], "u1", 0, 10_000, 10);
  assert.deepEqual(readStoredLinks(raw, "u2", 0, 10_000), []);
});

test("a link with too little time left is neither written nor read back", () => {
  const raw = storedLinksForm([["a", entry("https://x/a", 50_000)], ["b", entry("https://x/b", 8_000)]], "u1", 0, 10_000, 10);
  assert.deepEqual(readStoredLinks(raw, "u1", 0, 10_000).map(([k]) => k), ["a"]);
  assert.deepEqual(readStoredLinks(raw, "u1", 45_000, 10_000), []);
});

test("failed and pending links are not written", () => {
  const raw = storedLinksForm([["a", entry(null, 100_000)], ["b", entry(undefined, 100_000)]], "u1", 0, 0, 10);
  assert.deepEqual(readStoredLinks(raw, "u1", 0, 0), []);
});

test("only the newest links are kept past the cap", () => {
  const cache: [string, Entry][] = ["a", "b", "c"].map((k) => [k, entry(`https://x/${k}`, 100_000)]);
  assert.deepEqual(readStoredLinks(storedLinksForm(cache, "u1", 0, 0, 2), "u1", 0, 0).map(([k]) => k), ["b", "c"]);
});

test("missing or malformed storage reads as no links", () => {
  for (const raw of [null, "", "not json", "null", "[]", '{"user":"u1"}', '{"user":"u1","links":{"a":"x","b":[1,2]}}']) {
    assert.deepEqual(readStoredLinks(raw, "u1", 0, 0), []);
  }
});
