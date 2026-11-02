// lib/timeline/matters.ts: rows map to matters and links, names are checked, and a matter holds the items its links name.

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMatterName, linkRefOf, mapMatter, mapMatterLink, matterRefs, mattersOf, MATTER_NAME_MAX, sortMatters, type Matter, type MatterLink } from "./matters";

const matter = (id: string, over: Partial<Matter> = {}): Matter => ({ id, contactId: "c", name: id, kind: "deal", closed: false, createdAt: "2026-11-01T00:00:00Z", closedAt: null, ...over });

test("a row becomes a matter; an unknown kind is a plain matter and an empty name reads as its kind", () => {
  const m = mapMatter({ id: "1", contact_id: "c", name: " 12 Oak Street ", kind: "listing", status: "closed", created_at: "x", closed_at: "y" });
  assert.deepEqual([m.name, m.kind, m.closed], ["12 Oak Street", "listing", true]);
  const odd = mapMatter({ id: "1", contact_id: "c", name: "", kind: "from-the-future", status: "open", created_at: "x", closed_at: null });
  assert.deepEqual([odd.name, odd.kind, odd.closed], ["Matter", "matter", false]);
});

test("a link row names exactly one target", () => {
  assert.deepEqual(mapMatterLink({ id: "l", matter_id: "m", thread_id: null, note_id: "n", attachment_id: null, meeting_id: null }), { id: "l", matterId: "m", kind: "note", targetId: "n" });
  assert.equal(mapMatterLink({ id: "l", matter_id: "m", thread_id: null, note_id: null, attachment_id: null, meeting_id: null }), null);
});

test("names are squeezed, and an empty or long one is refused", () => {
  assert.deepEqual(checkMatterName("  12   Oak  Street "), { name: "12 Oak Street", error: null });
  assert.equal(checkMatterName("   ").name, null);
  assert.match(checkMatterName("x".repeat(MATTER_NAME_MAX + 1)).error ?? "", /60/);
});

test("open matters come first, newest first, closed ones after", () => {
  const sorted = sortMatters([matter("old", { createdAt: "2026-01-01T00:00:00Z" }), matter("shut", { closed: true, createdAt: "2026-12-01T00:00:00Z" }), matter("new", { createdAt: "2026-06-01T00:00:00Z" })]);
  assert.deepEqual(sorted.map((m) => m.id), ["new", "old", "shut"]);
});

test("a matter holds the refs its links name, and an item shows the matters that hold it", () => {
  const links: MatterLink[] = [
    { id: "1", matterId: "a", kind: "thread", targetId: "t1" },
    { id: "2", matterId: "a", kind: "note", targetId: "n1" },
    { id: "3", matterId: "b", kind: "thread", targetId: "t1" },
  ];
  assert.deepEqual([...matterRefs(links, "a")].sort(), ["note:n1", "thread:t1"]);
  assert.deepEqual(mattersOf(["thread:t1"], links, [matter("a"), matter("b"), matter("c")]).map((m) => m.id), ["a", "b"]);
  assert.deepEqual(mattersOf(["thread:zzz"], links, [matter("a")]), []);
});

test("linking picks the most specific thing: a file before its conversation", () => {
  assert.deepEqual(linkRefOf(["attachment:f", "thread:t"]), { kind: "attachment", id: "f" });
  assert.deepEqual(linkRefOf(["thread:t"]), { kind: "thread", id: "t" });
  assert.equal(linkRefOf([]), null);
});
