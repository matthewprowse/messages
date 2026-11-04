// Tests for contacts-list-cache.ts: the kept lists are per person, merge as they change, are trusted only while young
// and in step with the store, and say which of the store's changes are still to apply.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTACTS_FRESH_MS, changesSeen, contactsSnapshot, isListFresh, saveContactsSnapshot } from "./contacts-list-cache";
import { clearMemoryCaches } from "./memory-cache";
import type { ContactSummary } from "./contacts";

const ann = { id: "c1", name: "Ann" } as ContactSummary;

test("a snapshot is kept per person and merged as it changes", () => {
  clearMemoryCaches();
  saveContactsSnapshot("u1", { contacts: [ann], at: { contacts: 100 }, refreshed: 2 });
  saveContactsSnapshot("u1", { suggestions: [], at: { suggestions: 200 } });
  const snap = contactsSnapshot("u1");
  assert.deepEqual(snap?.contacts, [ann]);
  assert.deepEqual(snap?.suggestions, []);
  assert.deepEqual(snap?.at, { contacts: 100, companies: 0, suggestions: 200 });
  assert.equal(snap?.refreshed, 2);
  assert.equal(contactsSnapshot("u2"), undefined);
  assert.equal(contactsSnapshot(undefined), undefined);
});

test("a young list in step with the store skips its read; an old one, a refreshed store or a missing list does not", () => {
  clearMemoryCaches();
  saveContactsSnapshot("u1", { contacts: [ann], at: { contacts: 1000 }, refreshed: 1, seen: 3 });
  const snap = contactsSnapshot("u1");
  const store = { refreshed: 1, changes: 3 };
  assert.ok(isListFresh(snap, "contacts", store, 1000 + CONTACTS_FRESH_MS - 1));
  assert.ok(!isListFresh(snap, "contacts", store, 1000 + CONTACTS_FRESH_MS));
  assert.ok(!isListFresh(snap, "contacts", { refreshed: 2, changes: 3 }, 1001));
  assert.ok(!isListFresh(snap, "contacts", { refreshed: 1, changes: 0 }, 1001));
  assert.ok(!isListFresh(snap, "companies", store, 1001));
});

test("changes are applied from where the kept lists left off, or from now without them", () => {
  clearMemoryCaches();
  assert.equal(changesSeen(undefined, 5), 5);
  saveContactsSnapshot("u1", { seen: 2 });
  assert.equal(changesSeen(contactsSnapshot("u1"), 5), 2);
  // The store started over (fewer changes than were seen): nothing old is applied twice.
  assert.equal(changesSeen(contactsSnapshot("u1"), 1), 1);
});
