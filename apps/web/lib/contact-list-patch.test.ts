// Tests for contact-list-patch.ts: the Contacts lists after a merge, a hide, a change of kind and a delete.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContactSummary } from "./contacts";
import { mergeCompanies, mergeSuggestions, mergeSummaries, patchSummary, removeSummary } from "./contact-list-patch";

const row = (id: string, name: string, extra: Partial<ContactSummary> = {}): ContactSummary => ({
  id, name, company: null, role: null, emails: [], phones: [], handles: [], hasLinkedIn: false, lastAt: null, isCompany: false, organizationName: null, conversationCount: 0, hasWhatsApp: false, hidden: false, ...extra,
});
const sug = (id: string, a: string, b: string) => ({ id, contactA: a, contactB: b, reason: "same_name", score: 0.9 });

test("a merge folds the other row into the kept one", () => {
  const list = [
    row("a", "Sam", { emails: ["s@x.com"], lastAt: "2026-01-01", conversationCount: 2 }),
    row("b", "Sam J", { phones: ["+27821234567"], hasWhatsApp: true, lastAt: "2026-03-01", conversationCount: 3 }),
  ];
  const out = mergeSummaries(list, "a", "b");
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].emails, out[0].phones, out[0].hasWhatsApp, out[0].lastAt, out[0].conversationCount], [["s@x.com"], ["+27821234567"], true, "2026-03-01", 5]);
});

test("suggestions that became one person go, and the rest point at the kept person once", () => {
  const out = mergeSuggestions([sug("1", "a", "b"), sug("2", "b", "c"), sug("3", "a", "c"), sug("4", "x", "y")], "a", "b");
  assert.deepEqual(out.map((s) => s.id), ["2", "4"]);
  assert.deepEqual([out[0].contactA, out[0].contactB], ["a", "c"]);
});

test("a company loses a person when theirs is merged away, and goes when it has none", () => {
  const companies = [{ id: "o1", name: "Acme", domain: "acme.com", summary: null, people: 2, addresses: 2, conversations: 1, lastAt: null }, { id: "o2", name: "Solo", domain: "solo.com", summary: null, people: 1, addresses: 1, conversations: 0, lastAt: null }];
  assert.equal(mergeCompanies(companies, { organizationName: "Acme" })[0].people, 1);
  assert.deepEqual(mergeCompanies(companies, { organizationName: "Solo" }).map((c) => c.id), ["o1"]);
  assert.equal(mergeCompanies(companies, { organizationName: null }), companies);
});

test("hiding and changing kind patch one row; a delete removes it", () => {
  const list = [row("a", "Acme Team", { emails: ["team@acme.com"], organizationName: "Acme", isCompany: true }), row("b", "Bo")];
  const hidden = patchSummary(list, "b", { hidden: true });
  assert.equal(hidden[1].hidden, true);
  assert.equal(hidden[0], list[0]);
  assert.equal(patchSummary(list, "a", { kindOverride: "person" })[0].isCompany, false);
  assert.deepEqual(removeSummary(list, "a").map((c) => c.id), ["b"]);
  assert.equal(removeSummary(list, "zzz"), list);
});
