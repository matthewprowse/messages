// Tests for lib/attachment-filters.ts: what the address remembers, the derived Source list, date and search matching, the
// honest header counts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { filterFiles, filtersHref, isNarrowed, isVoiceNote, NO_FILTERS, parseFilters, searchTextOf, sourcesIn, type FilterContext } from "./attachment-filters";
import type { FiledAttachment } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-02T12:00:00Z");
const file = (id: string, over: Partial<FiledAttachment> = {}) => ({ id, name: `${id}.pdf`, kind: "pdf", sentAt: "2026-11-01T10:00:00Z", from: "c1", threadId: "t1", messageId: "m1", ...over }) as FiledAttachment;
const ctx = (over: Partial<FilterContext> = {}): FilterContext => ({ sourceOf: () => "gmail", text: (a) => a.name.toLowerCase(), now: NOW, ...over });

test("the address round trips every filter and writes only what is not the default", () => {
  const f = { kind: "pdf" as const, source: "outlook", date: "month", q: "invoice", sort: "largest" as const };
  const href = filtersHref(f);
  assert.equal(href, "/attachments?kind=pdf&source=outlook&date=month&q=invoice&sort=largest");
  assert.deepEqual(parseFilters((k) => new URL(href, "http://x").searchParams.get(k)), f);
  assert.equal(filtersHref(NO_FILTERS), "/attachments");
  assert.deepEqual(parseFilters(() => null), NO_FILTERS);
  assert.equal(parseFilters((k) => (k === "kind" ? "media" : k === "date" ? "decade" : null)).kind, "all");
  assert.equal(parseFilters((k) => (k === "date" ? "decade" : null)).date, "any");
  // The Sent By filter is gone: an old link that carries a person opens with every file.
  assert.deepEqual(parseFilters((k) => (k === "person" ? "c9" : null)), NO_FILTERS);
});

test("only a source, date, search or the Largest sort narrows the list, not the tab", () => {
  assert.equal(isNarrowed({ ...NO_FILTERS, kind: "pdf" }), false);
  for (const over of [{ source: "gmail" }, { date: "week" }, { q: "x" }, { sort: "largest" as const }]) assert.equal(isNarrowed({ ...NO_FILTERS, ...over }), true);
  assert.equal(isNarrowed({ ...NO_FILTERS, q: "  " }), false);
});

test("sources come from the data: Outlook, LinkedIn and Instagram appear, a calendar does not, and each shows once", () => {
  const found = sourcesIn(["gmail", "outlook", "linkedin", "instagram", "outlook", undefined, "google_calendar", "imap", "whatsapp"]);
  assert.deepEqual(found.map((s) => s.key), ["gmail", "instagram", "linkedin", "imap", "outlook", "whatsapp"]);
  assert.equal(found.find((s) => s.key === "imap")?.label, "Other Email");
  assert.deepEqual(sourcesIn([]), []);
});

test("the source filter matches a file's own provider, so an Outlook file can be chosen", () => {
  const files = [file("a"), file("b")];
  const bySource = ctx({ sourceOf: (a) => (a.id === "a" ? "outlook" : "gmail") });
  assert.deepEqual(filterFiles(files, { ...NO_FILTERS, source: "outlook" }, bySource).map((a) => a.id), ["a"]);
  assert.equal(filterFiles(files, NO_FILTERS, bySource).length, 2);
});

test("the date filter compares real times, so an offset spelling of the same moment does not slip through", () => {
  const files = [file("old", { sentAt: new Date(NOW - 10 * DAY).toISOString() }), file("new", { sentAt: "2026-11-01T23:30:00+02:00" })];
  assert.deepEqual(filterFiles(files, { ...NO_FILTERS, date: "week" }, ctx()).map((a) => a.id), ["new"]);
  assert.equal(filterFiles(files, { ...NO_FILTERS, date: "month" }, ctx()).length, 2);
});

test("a search needs every word, and the subject text counts when the page supplies it", () => {
  const text = { a: searchTextOf("scan0042.pdf", "Anna", "anna@x.co", "Invoice for October"), b: searchTextOf("notes.pdf", "Ben") };
  const files = [file("a"), file("b")];
  const c = ctx({ text: (a) => text[a.id as "a" | "b"] });
  assert.deepEqual(filterFiles(files, { ...NO_FILTERS, q: "invoice anna" }, c).map((a) => a.id), ["a"]);
  assert.equal(filterFiles(files, { ...NO_FILTERS, q: "invoice ben" }, c).length, 0);
});

test("the Audio tab leaves voice notes out and keeps real audio files", () => {
  const files = [file("v", { kind: "audio", name: "Voice Note.ogg" }), file("s", { kind: "audio", name: "song.mp3" })];
  assert.equal(isVoiceNote(files[0]), true);
  assert.deepEqual(filterFiles(files, { ...NO_FILTERS, kind: "audio" }, ctx()).map((a) => a.id), ["s"]);
});
