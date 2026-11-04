// Tests for prefetch-picks.ts: which conversations the idle prefetch loads before they are opened.

import assert from "node:assert/strict";
import { test } from "node:test";
import { idlePrefetchIds } from "./prefetch-picks";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const t = (id: string, at: string, p: Partial<Parameters<typeof idlePrefetchIds>[0][number]> = {}) => ({
  id, unread: false, priority: "normal" as const, needsReply: false, lastFromMe: false, junk: false, status: "inbox" as const, lastMessageAt: at, pinned: false, snoozedUntil: undefined, snoozeKind: undefined, ...p,
});
const none = () => false;

test("only unread conversations and ones that need a reply are picked, newest first", () => {
  const ids = idlePrefetchIds([
    t("read", "2026-11-03T11:00:00Z"),
    t("old-unread", "2026-11-01T09:00:00Z", { unread: true }),
    t("reply", "2026-11-03T10:00:00Z", { needsReply: true }),
    t("new-unread", "2026-11-03T11:30:00Z", { unread: true }),
  ], none, 5, NOW);
  assert.deepEqual(ids, ["new-unread", "reply", "old-unread"]);
});

test("pinned ones come first, as in the list", () => {
  const ids = idlePrefetchIds([t("a", "2026-11-03T11:00:00Z", { unread: true }), t("pin", "2026-10-01T00:00:00Z", { unread: true, pinned: true })], none, 5, NOW);
  assert.deepEqual(ids, ["pin", "a"]);
});

test("junk, archived, snoozed and answered conversations are left alone", () => {
  const ids = idlePrefetchIds([
    t("junk", "2026-11-03T11:00:00Z", { unread: true, junk: true }),
    t("archived", "2026-11-03T11:00:00Z", { unread: true, status: "archived" }),
    t("snoozed", "2026-11-03T11:00:00Z", { unread: true, snoozedUntil: "2026-11-04T08:00:00Z" }),
    t("answered", "2026-11-03T11:00:00Z", { needsReply: true, lastFromMe: true }),
  ], none, 5, NOW);
  assert.deepEqual(ids, []);
});

test("loaded ones are skipped without using up the limit", () => {
  const threads = ["a", "b", "c", "d"].map((id, i) => t(id, `2026-11-03T1${i}:00:00Z`, { unread: true }));
  assert.deepEqual(idlePrefetchIds(threads, (id) => id === "d", 2, NOW), ["c", "b"]);
  assert.deepEqual(idlePrefetchIds(threads, none, 0, NOW), []);
});
