// Tests lib/updates-model.ts: row mapping, draft problems, ordering that an edit cannot disturb, the next version and dates.

import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanChanges, draftSnapshot, fromDateKey, dayLabel, mapUpdate, nextVersion, publishWarning, sortUpdates, updateProblem, type Row, type Update, type UpdateDraft } from "./updates-model";

const row = (over: Partial<Row> = {}): Row => ({ id: "a", version: "0.0.4", title: "T", summary: null, changes: [], released_on: "2026-11-01", published: false, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", ...over });
const upd = (id: string, releasedOn: string, createdAt: string, version = ""): Update => ({ ...mapUpdate(row({ id, released_on: releasedOn, created_at: createdAt })), version });
const draft = (over: Partial<UpdateDraft> = {}): UpdateDraft => ({ version: "", title: "T", summary: "", changes: [], releasedOn: "2026-11-01", published: false, ...over });

test("mapUpdate keeps well formed changes and drops the rest", () => {
  const u = mapUpdate(row({ summary: "S", version: null, changes: [{ kind: "new", text: "A" }, { kind: "oops", text: "B" }, { kind: "fixed" }, "x"] }));
  assert.deepEqual(u.changes, [{ kind: "new", text: "A" }]);
  assert.equal(u.version, "");
  assert.equal(u.summary, "S");
  assert.equal(u.updatedAt, "2026-11-01T10:00:00Z");
  assert.deepEqual(mapUpdate(row({ changes: {} })).changes, []);
});

test("updateProblem checks title, version, summary and each change", () => {
  assert.equal(updateProblem(draft()), null);
  assert.match(updateProblem(draft({ title: "  " }))!, /title/);
  assert.match(updateProblem(draft({ title: "x".repeat(121) }))!, /title/);
  assert.match(updateProblem(draft({ version: "1".repeat(21) }))!, /version/);
  assert.match(updateProblem(draft({ summary: "x".repeat(501) }))!, /summary/);
  assert.match(updateProblem(draft({ changes: [{ kind: "new", text: "x".repeat(301) }] }))!, /change/);
});

test("cleanChanges trims and drops blanks; publishing with none is warned about", () => {
  assert.deepEqual(cleanChanges([{ kind: "new", text: " A " }, { kind: "fixed", text: "  " }]), [{ kind: "new", text: "A" }]);
  assert.ok(publishWarning(draft({ published: true, changes: [{ kind: "new", text: " " }] })));
  assert.equal(publishWarning(draft({ published: false })), null);
  assert.equal(publishWarning(draft({ published: true, changes: [{ kind: "new", text: "A" }] })), null);
});

test("sortUpdates: date, then created_at, and an edit does not move a row", () => {
  const list = [upd("a", "2026-11-01", "2026-11-01T09:00:00Z"), upd("b", "2026-11-01", "2026-11-01T11:00:00Z"), upd("c", "2026-11-05", "2026-11-01T08:00:00Z")];
  assert.deepEqual(sortUpdates(list).map((u) => u.id), ["c", "b", "a"]);
  // "a" saved again: same createdAt, new updatedAt, appended at the end of the list as the page used to do.
  const edited = { ...list[0], title: "Edited", updatedAt: "2026-11-02T00:00:00Z" };
  assert.deepEqual(sortUpdates([list[1], list[2], edited]).map((u) => u.id), ["c", "b", "a"]);
});

test("nextVersion adds one to the highest patch and keeps a leading v", () => {
  assert.equal(nextVersion([]), "");
  assert.equal(nextVersion([{ version: "" }, { version: "beta" }]), "");
  assert.equal(nextVersion([{ version: "0.0.9" }, { version: "0.0.12" }, { version: "0.0.10" }]), "0.0.13");
  assert.equal(nextVersion([{ version: "v0.1.0" }, { version: "v0.0.30" }]), "v0.1.1");
  assert.equal(nextVersion([{ version: "1.0.0" }, { version: "0.9.9" }]), "1.0.1");
});

test("dates are read as local days and labelled in long form", () => {
  assert.equal(fromDateKey("nope"), undefined);
  assert.equal(fromDateKey("2026-11-17")?.getDate(), 17);
  assert.equal(dayLabel("2026-11-17"), "17 November 2026");
  assert.equal(dayLabel(""), "");
});

test("draftSnapshot ignores spacing and blank change rows", () => {
  assert.equal(draftSnapshot(draft({ title: " T ", changes: [{ kind: "new", text: "" }] })), draftSnapshot(draft()));
  assert.notEqual(draftSnapshot(draft({ published: true })), draftSnapshot(draft()));
});
