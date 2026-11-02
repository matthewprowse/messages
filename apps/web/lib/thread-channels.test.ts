// Tests for thread-channels.ts: the header offers a person's Instagram and LinkedIn chats, not just WhatsApp.

import { test } from "node:test";
import assert from "node:assert/strict";
import { theirThreads } from "./thread-channels";
import type { Thread } from "./types";

const t = (id: string, channel: Thread["channel"], lastMessageAt: string, extra: Partial<Thread> = {}) =>
  ({ id, channel, lastMessageAt, participantIds: ["p"], status: "inbox", isGroup: false, ...extra }) as Thread;

test("emails come newest first and each chat channel keeps its newest thread", () => {
  const out = theirThreads([
    t("e1", "email", "2026-01-01"), t("e2", "email", "2026-02-01"),
    t("w1", "whatsapp", "2026-01-05"), t("w2", "whatsapp", "2026-03-05"),
    t("i1", "instagram", "2026-01-09"), t("l1", "linkedin", "2026-01-10"),
  ], "p");
  assert.deepEqual(out.emails.map((x) => x.id), ["e2", "e1"]);
  assert.equal(out.chats.get("whatsapp")?.id, "w2");
  assert.equal(out.chats.get("instagram")?.id, "i1");
  assert.equal(out.chats.get("linkedin")?.id, "l1");
});

test("groups, deleted threads and other people are left out", () => {
  const out = theirThreads([
    t("g", "whatsapp", "2026-01-01", { isGroup: true }),
    t("d", "instagram", "2026-01-01", { status: "trash" }),
    t("o", "linkedin", "2026-01-01", { participantIds: ["q"] }),
  ], "p");
  assert.equal(out.chats.size, 0);
  assert.equal(out.emails.length, 0);
});
