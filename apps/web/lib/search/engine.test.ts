// Tests for engine.ts: ranking, every operator, the bin, incremental changes and the memory cap.

import test from "node:test";
import assert from "node:assert/strict";
import { docId, MAX_MESSAGES, SearchEngine } from "./engine";
import { parseQuery } from "./query";
import type { Doc, Kind } from "./types";

const NOW = new Date(2026, 10, 2, 12, 0).getTime();
const DAY = 86_400_000;
const LIMITS = { thread: 10, message: 10, contact: 10, note: 10, event: 10, task: 10, file: 10 };

function doc(kind: Kind, ref: string, over: Partial<Doc> = {}): Doc {
  return { id: docId(kind, ref), k: kind, r: ref, t: "", x: "", at: NOW, ...over };
}
const find = (engine: SearchEngine, text: string, limits = LIMITS) => engine.search(parseQuery(text, new Date(NOW)), limits, NOW);
const ids = (r: ReturnType<typeof find>, kind: Kind) => r[kind].hits.map((h) => h.doc.r);

function sample() {
  const e = new SearchEngine();
  e.upsert([
    doc("thread", "t1", { t: "Jane Doe", x: "Quarterly figures", fr: "Jane Doe jane@acme.com", to: "Jane Doe jane@acme.com", u: 1 }),
    doc("thread", "t2", { t: "Bob Smith", x: "Lunch on Friday", fr: "Bob Smith bob@corp.io", to: "Bob Smith bob@corp.io" }),
    doc("thread", "t3", { t: "Old Chat", x: "gone", tr: 1 }),
    doc("message", "m1", { th: "t1", t: "Invoice 42", x: "Please find the invoice attached", fr: "Jane Doe jane@acme.com", to: "me@x.com", at: NOW - 2 * DAY, a: 1 }),
    doc("message", "m2", { th: "t1", x: "Thanks, I will pay the invoice on Monday", fr: "me", to: "Jane Doe jane@acme.com", me: 1, at: NOW - DAY }),
    doc("message", "m3", { th: "t2", x: "Are we still on for lunch?", fr: "Bob Smith bob@corp.io", to: "me@x.com", at: NOW - 40 * DAY }),
    doc("message", "m4", { th: "t3", x: "invoice in the bin", fr: "Old", at: NOW }),
    doc("contact", "c1", { t: "Jane Doe", x: "Acme Director jane@acme.com", at: 0 }),
    doc("note", "n1", { t: "Invoice Process", x: "How we send an invoice every month", at: NOW - 5 * DAY }),
    doc("event", "e1", { t: "Invoice Review", x: "Boardroom", at: NOW + DAY }),
    doc("task", "k1", { t: "Send invoice to Jane", x: "", at: NOW + 3 * DAY }),
    doc("file", "f1", { th: "t1", mi: "m1", t: "Invoice-42.pdf", fr: "Jane Doe jane@acme.com", at: NOW - 2 * DAY }),
  ]);
  return e;
}

test("a word is found in every kind and the groups come back separately", () => {
  const r = find(sample(), "invoice");
  assert.deepEqual(ids(r, "message").sort(), ["m1", "m2"]);
  assert.deepEqual(ids(r, "note"), ["n1"]);
  assert.deepEqual(ids(r, "event"), ["e1"]);
  assert.deepEqual(ids(r, "task"), ["k1"]);
  assert.deepEqual(ids(r, "file"), ["f1"]);
});

test("a title match outranks a text match, and a newer one wins a tie", () => {
  const r = find(sample(), "invoice");
  assert.equal(ids(r, "message")[0], "m1"); // title "Invoice 42" and the newer of the two text matches is m2, but the title counts more
  const tie = new SearchEngine();
  tie.upsert([doc("message", "old", { x: "hello world", at: NOW - 30 * DAY }), doc("message", "new", { x: "hello world", at: NOW - DAY })]);
  assert.deepEqual(ids(find(tie, "hello"), "message"), ["new", "old"]);
});

test("every word has to match, in any order, and accents and case are ignored", () => {
  const e = new SearchEngine();
  e.upsert([doc("contact", "c", { t: "Zoë Müller", x: "", at: 0 })]);
  assert.deepEqual(ids(find(e, "muller ZOE"), "contact"), ["c"]);
  assert.deepEqual(ids(find(e, "zoe jones"), "contact"), []);
});

test("a phrase must appear as written", () => {
  const r = find(sample(), '"pay the invoice"');
  assert.deepEqual(ids(r, "message"), ["m2"]);
  assert.deepEqual(ids(find(sample(), '"invoice the pay"'), "message"), []);
});

test("from: matches the sender and from:me matches your own messages", () => {
  const e = sample();
  assert.deepEqual(ids(find(e, "from:jane invoice"), "message"), ["m1"]);
  assert.deepEqual(ids(find(e, "from:me invoice"), "message"), ["m2"]);
  assert.deepEqual(ids(find(e, "from:jane invoice"), "note"), []);
});

test("to: matches the recipient and to:me matches what you received", () => {
  const e = sample();
  assert.deepEqual(ids(find(e, "to:jane"), "message"), ["m2"]);
  assert.deepEqual(ids(find(e, "to:me lunch"), "message"), ["m3"]);
});

test("has:attachment finds messages, files and the conversations that hold them", () => {
  const r = find(sample(), "has:attachment");
  assert.deepEqual(ids(r, "message"), ["m1"]);
  assert.deepEqual(ids(r, "file"), ["f1"]);
  assert.deepEqual(ids(r, "thread"), ["t1"]);
  assert.deepEqual(ids(r, "note"), []);
});

test("is:unread follows the conversation, for its messages too", () => {
  const r = find(sample(), "is:unread");
  assert.deepEqual(ids(r, "thread"), ["t1"]);
  assert.deepEqual(ids(r, "message").sort(), ["m1", "m2"]);
  assert.deepEqual(ids(r, "contact"), []);
});

test("before: and after: bound the time, and leave out things with no time", () => {
  const e = sample();
  const cut = (d: number) => new Date(NOW - d * DAY);
  const iso = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  assert.deepEqual(ids(find(e, `invoice before:${iso(cut(1))}`), "message"), ["m1"]);
  assert.deepEqual(ids(find(e, `invoice after:${iso(cut(1))}`), "message"), ["m2"]);
  assert.deepEqual(ids(find(e, `after:${iso(cut(100))}`), "contact"), []);
});

test("conversations in the bin and everything in them stay out", () => {
  const r = find(sample(), "bin");
  assert.deepEqual(ids(r, "message"), []);
  assert.deepEqual(ids(find(sample(), "old chat"), "thread"), []);
});

test("totals count every match even when only a few are returned", () => {
  const e = new SearchEngine();
  e.upsert(Array.from({ length: 30 }, (_, i) => doc("message", `m${i}`, { x: "budget", at: NOW - i * DAY })));
  const r = find(e, "budget", { ...LIMITS, message: 5 });
  assert.equal(r.message.hits.length, 5);
  assert.equal(r.message.total, 30);
  assert.equal(r.message.hits[0].doc.r, "m0");
});

test("a snippet starts near the first match", () => {
  const e = new SearchEngine();
  e.upsert([doc("message", "m", { x: `${"filler ".repeat(30)}the NEEDLE is here` })]);
  const snippet = find(e, "needle").message.hits[0].snippet!;
  assert.ok(snippet.startsWith("…"));
  assert.ok(snippet.includes("NEEDLE"));
});

test("changing a document replaces it, and removing one takes it out of the next search", () => {
  const e = sample();
  e.upsert([doc("note", "n1", { t: "Renamed Note", x: "nothing about money", at: NOW })]);
  assert.deepEqual(ids(find(e, "invoice"), "note"), []);
  assert.deepEqual(ids(find(e, "renamed"), "note"), ["n1"]);
  e.remove([docId("note", "n1"), docId("message", "m1")]);
  assert.equal(e.has(docId("note", "n1")), false);
  assert.deepEqual(ids(find(e, "invoice"), "message"), ["m2"]);
  assert.equal(e.count("message"), 3);
});

test("removing a message takes its files with it", () => {
  const e = sample();
  const removed = e.removeMessages(["m1"]);
  assert.deepEqual(removed.sort(), [docId("file", "f1"), docId("message", "m1")].sort());
  assert.equal(e.count("file"), 0);
});

test("reading a thread, or binning it, takes effect on its messages at once", () => {
  const e = sample();
  e.upsert([doc("thread", "t1", { t: "Jane Doe", fr: "Jane Doe", to: "Jane Doe" })]);
  assert.deepEqual(ids(find(e, "is:unread"), "message"), []);
  e.upsert([doc("thread", "t2", { t: "Bob Smith", tr: 1 })]);
  assert.deepEqual(ids(find(e, "lunch"), "message"), []);
});

test("threadIds gives a conversation for a hit on itself, a message or a file", () => {
  const e = sample();
  assert.deepEqual([...e.threadIds(parseQuery("lunch", new Date(NOW)))], ["t2"]);
  assert.deepEqual([...e.threadIds(parseQuery("invoice-42", new Date(NOW)))], ["t1"]);
  assert.deepEqual([...e.threadIds(parseQuery("invoice", new Date(NOW)))], ["t1"]);
});

test("stamps list a kind's rows with their times", () => {
  const e = sample();
  assert.deepEqual(e.stamps("note"), [["n1", NOW - 5 * DAY]]);
});

test("past the cap the oldest messages are dropped and reported", () => {
  const e = new SearchEngine();
  const docs = Array.from({ length: MAX_MESSAGES + 10 }, (_, i) => doc("message", `m${i}`, { x: "a", at: i + 1 }));
  const dropped = e.upsert(docs);
  assert.ok(dropped.length >= 10);
  assert.equal(dropped[0], docId("message", "m0"));
  assert.ok(e.count("message") <= MAX_MESSAGES);
  assert.equal(e.has(docId("message", `m${MAX_MESSAGES + 9}`)), true);
});
