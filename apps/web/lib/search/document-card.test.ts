// Tests for document-card.ts: reading the opened card, the labels a tile and the viewer show, the page's filters, the
// words added to the private search index, and the task "Invoice due 30 Nov" becomes.

import assert from "node:assert/strict";
import test from "node:test";
import { cardFacts, cardSearchText, cardTaskForm, docFilterOf, dueLabel, amountLabel, matchesDocFilter, parseDocCard, taskTitle, tileLine } from "./document-card";
import { messageDocs, type MessageRow } from "./docs";
import { SearchEngine } from "./engine";
import { parseQuery } from "./query";

const INVOICE = JSON.stringify({ v: 1, type: "invoice", counterparty: "Sipho Plumbing", amount: 1250.5, currency: "ZAR", due: "2026-11-30", reference: "INV-0042", summary: "An invoice for plumbing work." });
const NOW = new Date("2026-11-02T10:00:00Z");

test("a stored card is read, and anything else is no card", () => {
  const card = parseDocCard(INVOICE);
  assert.deepEqual(card, { type: "invoice", counterparty: "Sipho Plumbing", amount: 1250.5, currency: "ZAR", due: "2026-11-30", reference: "INV-0042", summary: "An invoice for plumbing work." });
  assert.equal(parseDocCard(null), null);
  assert.equal(parseDocCard("e1:sealed"), null);
  assert.equal(parseDocCard(JSON.stringify({ type: "poem", summary: "x" })), null);
  assert.equal(parseDocCard(JSON.stringify({ type: "invoice", summary: "" })), null);
});

test("a bad amount, currency or date is dropped rather than shown", () => {
  const card = parseDocCard(JSON.stringify({ type: "quote", summary: "A quote.", amount: -5, currency: "rand", due: "2026-02-31" }));
  assert.deepEqual([card?.amount, card?.currency, card?.due], [null, "ZAR", null]);
});

test("amounts are written with spaces between thousands and rand as R", () => {
  assert.equal(amountLabel(1250.5, "ZAR"), "R 1 250.50");
  assert.equal(amountLabel(1234567, "USD"), "USD 1 234 567.00");
  assert.equal(amountLabel(99, "ZAR"), "R 99.00");
});

test("a due date drops the year only in the current one", () => {
  assert.equal(dueLabel("2026-11-30", NOW), "30 Nov");
  assert.equal(dueLabel("2027-01-05", NOW), "5 Jan 2027");
});

test("the tile line and the viewer facts list only what the document gave", () => {
  const card = parseDocCard(INVOICE)!;
  assert.equal(tileLine(card), "Invoice, R 1 250.50");
  assert.deepEqual(cardFacts(card, NOW).map((f) => f.label), ["With", "Amount", "Due", "Reference"]);
  const bare = parseDocCard(JSON.stringify({ type: "id", summary: "An ID." }))!;
  assert.equal(tileLine(bare), "ID");
  assert.deepEqual(cardFacts(bare), []);
});

test("the filters know their types, and a file with no card passes only Any Document", () => {
  const card = parseDocCard(INVOICE)!;
  assert.equal(docFilterOf("contract"), "contract");
  assert.equal(docFilterOf("nonsense"), "all");
  assert.equal(docFilterOf(null), "all");
  assert.equal(matchesDocFilter(card, "invoice"), true);
  assert.equal(matchesDocFilter(card, "contract"), false);
  assert.equal(matchesDocFilter(null, "invoice"), false);
  assert.equal(matchesDocFilter(null, "all"), true);
});

test("an invoice with a due date becomes one click into a dated task", () => {
  const card = parseDocCard(INVOICE)!;
  assert.equal(taskTitle(card, NOW), "Invoice due 30 Nov");
  assert.deepEqual(cardTaskForm(card, "acc", "Invoice 42.pdf", NOW), { title: "Invoice due 30 Nov", notes: "Sipho Plumbing, INV-0042, R 1 250.50, File: Invoice 42.pdf", accountId: "acc", date: "2026-11-30", time: "", priority: 0 });
  assert.equal(cardTaskForm({ ...card, due: null }, "acc", "x.pdf", NOW), null);
});

test("a card adds the words people search with, and nothing without one", () => {
  assert.match(cardSearchText(parseDocCard(INVOICE)), /invoice.*Sipho Plumbing.*INV-0042.*R 1 250.50/);
  assert.equal(cardSearchText(null), "");
  assert.match(cardSearchText(parseDocCard(JSON.stringify({ type: "proof_of_payment", summary: "Paid." }))), /receipt/);
});

test("'invoice from Sipho' finds the file the card is on, and the file with no card has no words", () => {
  const row: MessageRow = { id: "m1", thread_id: "t1", direction: "inbound", sender_contact_id: null, sender_address: "sipho@example.com", to_addresses: ["me@example.com"], sent_at: "2026-11-01T08:00:00Z", subject: "Hello", body_text: "Attached.", attachments: [{ id: "a1", filename: "scan0001.pdf", doc_card: INVOICE }, { id: "a2", filename: "other.pdf" }] };
  const docs = messageDocs(row, { nameOf: () => undefined, peersOf: () => "" });
  const files = docs.filter((d) => d.k === "file");
  assert.match(files[0].x, /Sipho Plumbing/);
  assert.equal(files[1].x, "");
  const engine = new SearchEngine();
  engine.upsert(docs);
  const limits = { thread: 10, message: 10, contact: 10, note: 10, event: 10, task: 10, file: 10 };
  const found = engine.search(parseQuery("invoice sipho", new Date("2026-11-02T10:00:00Z")), limits, Date.parse("2026-11-02T10:00:00Z"));
  assert.deepEqual(found.file.hits.map((h) => h.doc.r), ["a1"]);
});
