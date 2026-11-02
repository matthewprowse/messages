// Tests for thread-runs.ts: photo albums, and the day and run grouping of a conversation with meetings in it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByDay, withAlbums } from "./thread-runs";
import type { Message } from "./types";
import type { Meeting } from "./meeting-text";

const msg = (id: string, from: string, sentAt: string, extra: Partial<Message> = {}) => ({ id, from, sentAt, body: "hi", threadId: "t", ...extra }) as Message;
const photo = (id: string, sentAt: string, name = "a.jpg") =>
  msg(id, "c1", sentAt, { body: "", attachments: [{ id: `${id}-a`, kind: "image", name }] as Message["attachments"] });
const isSticker = (a: { name: string }) => a.name.startsWith("Sticker.");
const meeting = (id: string, startedAt: string) => ({ id, startedAt }) as Meeting;

test("photos sent within two minutes gather into one album, a later one starts another", () => {
  const run = [photo("a", "2026-01-01T10:00:00Z"), photo("b", "2026-01-01T10:01:00Z"), photo("c", "2026-01-01T10:05:00Z")];
  assert.deepEqual(withAlbums(run, isSticker).map((g) => g.map((m) => m.id)), [["a", "b"], ["c"]]);
});

test("stickers, captions and text never join an album", () => {
  const run = [photo("a", "2026-01-01T10:00:00Z", "Sticker.webp"), photo("b", "2026-01-01T10:00:10Z"), msg("c", "c1", "2026-01-01T10:00:20Z"), photo("d", "2026-01-01T10:00:30Z")];
  assert.deepEqual(withAlbums(run, isSticker).map((g) => g.length), [1, 1, 1, 1]);
});

test("a sender change splits runs, and a new day starts a new group", () => {
  const groups = groupByDay([msg("a", "c1", "2026-01-01T10:00:00Z"), msg("b", "c1", "2026-01-01T10:01:00Z"), msg("c", "me", "2026-01-01T10:02:00Z"), msg("d", "me", "2026-01-03T10:00:00Z")], [], new Map());
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].runs.map((r) => (r as Message[]).map((m) => m.id)), [["a", "b"], ["c"]]);
});

test("a meeting ends the run it lands in, and one after every message goes last", () => {
  const msgs = [msg("a", "c1", "2026-01-01T10:00:00Z"), msg("b", "c1", "2026-01-01T10:10:00Z")];
  const groups = groupByDay(msgs, [meeting("m1", "2026-01-01T10:05:00Z"), meeting("m2", "2026-01-01T11:00:00Z")], new Map());
  assert.deepEqual(groups[0].runs.map((r) => (Array.isArray(r) ? "run" : r.id)), ["run", "m1", "run", "m2"]);
});

test("a run keeps its key when older messages are prepended, and a split run's halves get different keys", () => {
  const keys = new Map<string, string>();
  groupByDay([msg("b", "c1", "2026-01-01T10:00:00Z")], [], keys);
  assert.equal(keys.get("b"), "b");
  groupByDay([msg("a", "c1", "2026-01-01T09:00:00Z"), msg("b", "c1", "2026-01-01T10:00:00Z")], [], keys);
  assert.equal(keys.get("a"), "b");
  const split = new Map([["a", "k"], ["b", "k"]]);
  groupByDay([msg("a", "c1", "2026-01-01T10:00:00Z"), msg("b", "c1", "2026-01-01T10:10:00Z")], [meeting("m", "2026-01-01T10:05:00Z")], split);
  assert.notEqual(split.get("a"), split.get("b"));
});
