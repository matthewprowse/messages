// Tests for map-thread.ts: who leads a conversation, and how a thread row becomes a Thread (defaults, WhatsApp names).

import assert from "node:assert/strict";
import { test } from "node:test";
import { leadParticipant, mapThread, threadWithIds } from "./map-thread";
import type { ThreadRow } from "./columns";

const row = (over: Partial<ThreadRow> = {}): ThreadRow => ({
  id: "t1", account_id: "a1", channel: "email", subject: null, is_group: false, group_name: null, avatar_path: null, provider_thread_id: "p1",
  last_message_at: null, created_at: "2026-01-01T00:00:00Z", last_message_preview: null, junk: false, subscription: false, last_sender_contact_id: null,
  unread_count: 0, pinned: false, status: "open", priority: null, category: null, summary: null, needs_reply: false, last_from_me: false, ...over,
} as ThreadRow);

test("the latest sender leads, and the rest keep their order", () => {
  assert.deepEqual(leadParticipant(["a", "b", "c"], "c"), ["c", "a", "b"]);
  assert.deepEqual(leadParticipant(["a", "b"], "a"), ["a", "b"]);
  assert.deepEqual(leadParticipant(["a", "b"], "z"), ["a", "b"]);
  assert.deepEqual(leadParticipant(["a", "b"], null), ["a", "b"]);
});

test("an untriaged thread is normal priority and fyi, and dates fall back to created_at", () => {
  const t = mapThread(row(), ["a"], "gmail");
  assert.equal(t.priority, "normal");
  assert.equal(t.category, "fyi");
  assert.equal(t.lastMessageAt, "2026-01-01T00:00:00Z");
  assert.equal(t.unread, false);
  assert.equal(t.summary, "");
});

test("a one to one WhatsApp chat is named by its number, short ids by WhatsApp, and groups and emails not at all", () => {
  assert.equal(mapThread(row({ channel: "whatsapp", provider_thread_id: "123@s.whatsapp.net" }), [], "whatsapp").fallbackName, "WhatsApp");
  assert.equal(mapThread(row({ channel: "whatsapp", provider_thread_id: "abc@g.us" }), [], "whatsapp").fallbackName, undefined);
  assert.equal(mapThread(row({ channel: "whatsapp", is_group: true, provider_thread_id: "123@g.us" }), [], "whatsapp").fallbackName, undefined);
  assert.equal(mapThread(row({ provider_thread_id: "27821234567" }), [], "gmail").fallbackName, undefined);
});

test("a listed thread takes its provider from the account, and iCloud when the account is missing", () => {
  const base = { ...row(), thread_participants: [{ contact_id: "x" }, { contact_id: "y" }] };
  assert.equal(threadWithIds({ ...base, accounts: { provider: "gmail" } }).provider, "gmail");
  assert.equal(threadWithIds({ ...base, accounts: null }).provider, "icloud");
  assert.deepEqual(threadWithIds({ ...base, accounts: null, last_sender_contact_id: "y" }).participantIds, ["y", "x"]);
});
