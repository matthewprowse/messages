// Tests for whatsapp/photo-jobs.ts: only stale or never-fetched pictures are due, a contact is looked up once, and an
// address book picture is never replaced.

import { test } from "node:test";
import assert from "node:assert/strict";
import { photoJobsDue, type PhotoThread } from "./photo-jobs";

const stale = "2026-01-01T00:00:00.000Z";
const chat = (id: string, contact: string, source: string | null, at: string | null): PhotoThread => ({
  id, is_group: false, provider_thread_id: `${id}@s.whatsapp.net`, avatar_updated_at: null,
  thread_participants: [{ contact_id: contact, contacts: { avatar_source: source, avatar_updated_at: at } }],
});
const group = (id: string, at: string | null): PhotoThread => ({ id, is_group: true, provider_thread_id: `${id}@g.us`, avatar_updated_at: at, thread_participants: [] });

test("a group is due when never fetched or stale, and not when fresh", () => {
  const jobs = photoJobsDue([group("a", null), group("b", "2025-12-01T00:00:00.000Z"), group("c", "2026-02-01T00:00:00.000Z")], stale);
  assert.deepEqual(jobs.map((j) => j.jid), ["a@g.us", "b@g.us"]);
});

test("a contact is looked up once, and only when its picture is WhatsApp's or unset", () => {
  const jobs = photoJobsDue([chat("t1", "c1", null, null), chat("t2", "c1", null, null), chat("t3", "c2", "address_book", null), chat("t4", "c3", "whatsapp", null)], stale);
  assert.deepEqual(jobs.map((j) => j.jid), ["t1@s.whatsapp.net", "t4@s.whatsapp.net"]);
});
