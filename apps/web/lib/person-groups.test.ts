// Tests for person-groups.ts: By Person puts a contact's email and chats in one row, keeps groups apart, and orders sensibly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByPerson, personHref } from "./person-groups";
import type { Thread } from "./types";

const t = (id: string, channel: Thread["channel"], lastMessageAt: string, extra: Partial<Thread> = {}) =>
  ({ id, channel, lastMessageAt, participantIds: ["p"], isGroup: false, unread: false, unreadCount: 0, pinned: false, ...extra }) as Thread;

test("a person's email and chats become one row led by the newest message", () => {
  const rows = groupByPerson([t("e", "email", "2026-01-01"), t("w", "whatsapp", "2026-03-01"), t("i", "instagram", "2026-02-01")]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].newest.id, "w");
  assert.deepEqual(rows[0].channels, ["whatsapp", "instagram", "email"]);
  assert.deepEqual(rows[0].threads.map((x) => x.id), ["w", "i", "e"]);
});

test("unread adds up across the person's conversations, counting a flagged one as at least one", () => {
  const rows = groupByPerson([t("e", "email", "2026-01-01", { unread: true, unreadCount: 0 }), t("w", "whatsapp", "2026-01-02", { unread: true, unreadCount: 3 }), t("x", "linkedin", "2026-01-03")]);
  assert.equal(rows[0].unread, 4);
});

test("groups and different people stay in rows of their own, and the input order is kept", () => {
  const rows = groupByPerson([t("g", "whatsapp", "2026-01-05", { isGroup: true }), t("a", "email", "2026-01-04", { participantIds: ["q"] }), t("b", "whatsapp", "2026-01-03"), t("c", "email", "2026-01-02")]);
  assert.deepEqual(rows.map((r) => r.key), ["g", "q", "p"]);
  assert.equal(rows[0].personId, undefined);
  assert.equal(rows[2].threads.length, 2);
});

test("a person row opens their timeline and a group row opens the conversation, both carrying the list query", () => {
  const [g, p] = groupByPerson([t("g", "whatsapp", "2026-01-05", { isGroup: true }), t("a", "email", "2026-01-04")]);
  assert.equal(personHref(g), "/inbox/g");
  assert.equal(personHref(p, "view=all&group=person"), "/inbox/person/p?view=all&group=person");
});

test("a pinned conversation pins the person's row", () => {
  assert.equal(groupByPerson([t("e", "email", "2026-01-01", { pinned: true }), t("w", "whatsapp", "2026-01-02")])[0].pinned, true);
});
