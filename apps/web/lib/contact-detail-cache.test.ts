// Tests for contact-detail-cache.ts: a first draw from the list or the store is partial and lists the store's
// conversations newest first, and a kept page is trusted only while young and with no contact change since.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheContact, cachedContact, isContactFresh, patchCachedContact, provisionalContact, storedConversations } from "./contact-detail-cache";
import { clearMemoryCaches } from "./memory-cache";
import type { ContactDetail, ContactSummary } from "./contacts";
import type { Contact, Thread } from "./types";

const thread = (id: string, at: string, extra: Partial<Thread> = {}) => ({ id, channel: "email", provider: "gmail", participantIds: ["c1"], lastMessageAt: at, status: "inbox", subject: `S ${id}`, ...extra }) as Thread;
const threads = [
  thread("t1", "2026-11-01T10:00:00Z"),
  thread("t2", "2026-11-02T10:00:00Z", { channel: "whatsapp", provider: "whatsapp", subject: undefined }),
  thread("t3", "2026-11-03T10:00:00Z", { status: "trash" }),
  thread("t4", "2026-11-03T10:00:00Z", { participantIds: ["c2"] }),
];

test("the store's conversations with someone are listed newest first, deleted ones and other people's left out", () => {
  const list = storedConversations("c1", threads);
  assert.deepEqual(list.map((c) => [c.id, c.title]), [["t2", "WhatsApp"], ["t1", "S t1"]]);
});

test("the list's row draws the page with its numbers, marked partial", () => {
  const listed = { id: "c1", name: "Ann", conversationCount: 7, lastInboundAt: "2026-11-02T00:00:00Z", vip: true, relationship: "Client" } as ContactSummary;
  const page = provisionalContact("c1", listed, undefined, threads);
  assert.ok(page?.partial);
  assert.equal(page?.name, "Ann");
  assert.equal(page?.conversationCount, 7);
  assert.equal(page?.relationship, "Client");
  assert.deepEqual(page?.attachments, []);
  assert.deepEqual(page?.identityRows, []);
});

test("without the list, the store's contact draws it and the numbers it lacks stay unknown", () => {
  const stored = { id: "c1", name: "Ann", initials: "A", hue: 1, emails: ["a@x.test"], phones: [], isCompany: false, organization: { id: "o1", name: "Acme" } } as Contact;
  const page = provisionalContact("c1", undefined, stored, threads);
  assert.equal(page?.company, "Acme");
  assert.deepEqual(page?.organization, { id: "o1", name: "Acme" });
  assert.equal(page?.conversationCount, 2);
  assert.equal(page?.hasWhatsApp, true);
  assert.equal(page?.lastInboundAt, undefined);
  assert.equal(provisionalContact("c9", undefined, undefined, threads), null);
});

test("a kept page is fresh only with the same contact version and changes, and takes a star from the list", () => {
  clearMemoryCaches();
  const detail = { id: "c1", name: "Ann", vip: false } as ContactDetail;
  cacheContact("u1", "c1", { detail, version: 3, changes: 1 });
  assert.ok(isContactFresh("u1", "c1", { version: 3, changes: 1 }));
  assert.ok(!isContactFresh("u1", "c1", { version: 4, changes: 1 }));
  assert.ok(!isContactFresh("u1", "c1", { version: 3, changes: 2 }));
  assert.ok(!isContactFresh("u2", "c1", { version: 3, changes: 1 }));
  patchCachedContact("u1", "c1", { vip: true });
  assert.equal(cachedContact("u1", "c1")?.detail.vip, true);
});
