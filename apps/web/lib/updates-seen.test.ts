// Tests lib/updates-seen.ts: which entry is newest, when the What's New dialog opens (seen marker, join date, setup), the
// grouping into New, Improved and Fixed, and the metadata marker.

import assert from "node:assert/strict";
import { test } from "node:test";
import { groupChanges, latestUpdate, mapReaderUpdate, seenFromMetadata, shouldShowWhatsNew, sortPublished, updateKey, type ReaderRow, type ReaderUpdate } from "./updates-seen";

const row = (over: Partial<ReaderRow> = {}): ReaderRow => ({ id: "a", version: "0.0.4", title: "T", summary: null, changes: [{ kind: "new", text: "A" }], released_on: "2026-11-01", published: true, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", published_at: "2026-11-02T08:00:00Z", ...over });
const upd = (over: Partial<ReaderRow> = {}): ReaderUpdate => mapReaderUpdate(row(over));

test("mapReaderUpdate carries publishedAt and the cleaned changes", () => {
  const u = upd({ changes: [{ kind: "fixed", text: "F" }, { kind: "bad", text: "X" }] });
  assert.equal(u.publishedAt, "2026-11-02T08:00:00Z");
  assert.deepEqual(u.changes, [{ kind: "fixed", text: "F" }]);
});

test("updateKey uses publishedAt and falls back to createdAt", () => {
  assert.equal(updateKey(upd()), "2026-11-02T08:00:00Z");
  assert.equal(updateKey(upd({ published_at: null })), "2026-11-01T10:00:00Z");
});

test("sortPublished puts the latest public entry first, whatever its release date", () => {
  const old = upd({ id: "o", released_on: "2026-12-01", published_at: "2026-11-01T00:00:00Z" });
  const fresh = upd({ id: "n", released_on: "2026-10-01", published_at: "2026-11-05T00:00:00Z" });
  assert.deepEqual(sortPublished([old, fresh]).map((u) => u.id), ["n", "o"]);
});

test("latestUpdate skips entries with nothing listed and handles an empty list", () => {
  assert.equal(latestUpdate([]), undefined);
  const empty = upd({ id: "e", changes: [], published_at: "2026-11-09T00:00:00Z" });
  const full = upd({ id: "f" });
  assert.equal(latestUpdate([empty, full])?.id, "f");
});

const base = { latest: upd(), onboarding: "done" as string | undefined };

test("the dialog opens when the newest entry is newer than the one seen", () => {
  assert.equal(shouldShowWhatsNew({ ...base, seen: "2026-11-01T00:00:00Z", joinedAt: "2026-01-01T00:00:00Z" }), true);
});

test("it stays closed once that entry has been seen", () => {
  assert.equal(shouldShowWhatsNew({ ...base, seen: "2026-11-02T08:00:00Z", joinedAt: "2026-01-01T00:00:00Z" }), false);
  assert.equal(shouldShowWhatsNew({ ...base, seen: "2026-11-03T00:00:00Z", joinedAt: undefined }), false);
});

test("someone who has seen nothing is compared with the day they joined", () => {
  assert.equal(shouldShowWhatsNew({ ...base, seen: undefined, joinedAt: "2026-10-01T00:00:00Z" }), true);
  assert.equal(shouldShowWhatsNew({ ...base, seen: undefined, joinedAt: "2026-11-03T00:00:00Z" }), false);
  assert.equal(shouldShowWhatsNew({ ...base, seen: undefined, joinedAt: undefined }), false);
  assert.equal(shouldShowWhatsNew({ ...base, seen: "garbage", joinedAt: "2026-10-01T00:00:00Z" }), true);
});

test("nothing opens with no entry, or while setup is running", () => {
  assert.equal(shouldShowWhatsNew({ latest: undefined, seen: undefined, joinedAt: "2026-01-01T00:00:00Z", onboarding: undefined }), false);
  assert.equal(shouldShowWhatsNew({ latest: upd(), seen: "2026-01-01T00:00:00Z", joinedAt: "2026-01-01T00:00:00Z", onboarding: "accounts" }), false);
  // People from before onboarding have no step at all and still see it.
  assert.equal(shouldShowWhatsNew({ latest: upd(), seen: "2026-01-01T00:00:00Z", joinedAt: "2026-01-01T00:00:00Z", onboarding: undefined }), true);
});

test("groupChanges orders New, Improved, Fixed and drops empty groups", () => {
  const g = groupChanges([{ kind: "fixed", text: "F" }, { kind: "new", text: "N1" }, { kind: "new", text: "N2" }]);
  assert.deepEqual(g.map((x) => [x.label, x.items]), [["New", ["N1", "N2"]], ["Fixed", ["F"]]]);
  assert.deepEqual(groupChanges([]), []);
});

test("seenFromMetadata only trusts a string", () => {
  assert.equal(seenFromMetadata({ whatsNewSeen: "x" }), "x");
  assert.equal(seenFromMetadata({ whatsNewSeen: 5 }), undefined);
  assert.equal(seenFromMetadata(undefined), undefined);
});
