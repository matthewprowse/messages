// Tests for map-small.ts: the empty profile, profile column mapping both ways, drafts and accounts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_PROFILE, latestSync, mapAccount, mapDraft, mapProfile, profilePatch } from "./map-small";
import type { ProfileRow } from "./columns";

test("a missing profile row is the empty profile", () => {
  assert.equal(mapProfile(null), EMPTY_PROFILE);
});

test("quiet hours lose their seconds and nulls become empty text", () => {
  const p = mapProfile({ display_name: null, avatar_path: null, about: null, important_people: null, quiet_start: "21:30:00", quiet_end: "06:00:00", push_urgent: true, push_important: false, auto_draft_top: true, whatsapp_read_receipts: true, share_usage: false, language: null } as ProfileRow);
  assert.equal(p.name, "");
  assert.equal(p.quietStart, "21:30");
  assert.equal(p.quietEnd, "06:00");
  assert.equal(p.pushImportant, false);
});

test("a profile patch carries only the fields given, under their column names", () => {
  assert.deepEqual(profilePatch({}), {});
  assert.deepEqual(profilePatch({ name: "A", quietStart: "20:00", pushUrgent: false }), { display_name: "A", quiet_start: "20:00", push_urgent: false });
  assert.deepEqual(profilePatch({ avatarPath: null }), { avatar_path: null });
});

test("a draft keeps its decision only when it has both text and kind", () => {
  const row = { id: "d", body: "b", tone: "warm", instruction: null, decision: "Yes?", decision_kind: null, source: null, auto: false, updated_at: "t" };
  assert.equal(mapDraft(row as never).decision, undefined);
  assert.deepEqual(mapDraft({ ...row, decision_kind: "yes_no" } as never).decision, { text: "Yes?", kind: "yes_no" });
  assert.equal(mapDraft(row as never).auto, undefined);
});

test("an account without send addresses gets an empty list", () => {
  const a = mapAccount({ id: "1", provider: "gmail", label: "L", nickname: null, address: "a@b.c", status: "connected", status_detail: null, last_synced_at: null, send_addresses: null } as never);
  assert.deepEqual(a.sendAddresses, []);
  assert.equal(a.detail, "a@b.c");
});

test("the last sync is the newer of the account's own time and the worker's heartbeat", () => {
  assert.equal(latestSync({ last_synced_at: "2026-11-02T10:00:00Z", account_heartbeats: { synced_at: "2026-11-02T12:00:00Z" } }), "2026-11-02T12:00:00Z");
  assert.equal(latestSync({ last_synced_at: "2026-11-02T13:00:00Z", account_heartbeats: [{ synced_at: "2026-11-02T12:00:00Z" }] }), "2026-11-02T13:00:00Z");
  assert.equal(latestSync({ last_synced_at: null, account_heartbeats: null }), undefined);
});

test("a draft for a portal lead keeps the lead's own address to reply to", () => {
  const row = { id: "d", body: "", tone: "default", instruction: null, decision: null, decision_kind: null, source: null, auto: false, updated_at: "2026-11-02T10:00:00Z", report: null, audit: null, feedback: null, reply_to: "thandi@example.co.za" };
  assert.equal(mapDraft(row as never).replyTo, "thandi@example.co.za");
  assert.equal(mapDraft({ ...row, reply_to: null } as never).replyTo, undefined);
});
