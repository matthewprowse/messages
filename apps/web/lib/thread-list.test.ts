// Tests for thread-list.ts: list links that drop defaults, address parsing, search matching and which accounts get a name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { accountNameMap, advanceTarget, channelsOf, emptyFor, filterFits, filterLabel, filterOf, filterOptions, inboxCounts, listHref, matchesSearch, rowMarker, stepTarget, viewOf, withQuery } from "./thread-list";
import type { Thread } from "./types";

test("a link leaves out the default view and a filter the view does not offer", () => {
  assert.equal(listHref("all", "none"), "/inbox");
  assert.equal(listHref("priority", "unread"), "/inbox?view=priority&filter=unread");
  assert.equal(listHref("subscriptions", "whatsapp"), "/inbox?view=subscriptions");
  assert.equal(listHref("all", "linkedin"), "/inbox?filter=linkedin");
  assert.equal(listHref("priority", "waiting"), "/inbox?view=priority");
});

test("a channel filter fits every view but Subscriptions and Deleted; Waiting only fits All", () => {
  assert.ok(filterFits("junk", "instagram"));
  assert.ok(!filterFits("subscriptions", "email"));
  assert.ok(filterFits("subscriptions", "unread"));
  assert.ok(!filterFits("deleted", "unread"));
  assert.ok(filterFits("all", "waiting"));
  assert.ok(!filterFits("archive", "waiting"));
});

test("the filter offers the channels you have, in a fixed order, and none with only one", () => {
  const channels = channelsOf([{ channel: "instagram" }, { channel: "email" }, { channel: "linkedin" }, { channel: "email" }]);
  assert.deepEqual(channels, ["email", "linkedin", "instagram"]);
  assert.deepEqual(filterOptions(channels).map((o) => o.label), ["No Filter", "Unread", "Email", "LinkedIn", "Instagram", "Waiting"]);
  assert.deepEqual(filterOptions(["email"]).map((o) => o.key), ["none", "unread", "waiting"]);
  assert.equal(filterLabel("whatsapp"), "WhatsApp");
  assert.equal(filterLabel("none"), undefined);
});

test("withQuery adds a question mark only when there is a query", () => {
  assert.equal(withQuery("/inbox/1", ""), "/inbox/1");
  assert.equal(withQuery("/inbox/1", "view=junk"), "/inbox/1?view=junk");
});

test("unknown views and filters fall back to the defaults", () => {
  assert.equal(viewOf("junk"), "junk");
  assert.equal(viewOf("nonsense"), "all");
  assert.equal(viewOf(null), "all");
  assert.equal(filterOf("waiting"), "waiting");
  assert.equal(filterOf("instagram"), "instagram");
  assert.equal(filterOf("nonsense"), "none");
  assert.equal(filterOf("constructor"), "none");
  assert.equal(filterOf(null), "none");
});

test("search matches the name, subject and preview, and a group's own name", () => {
  const t = { isGroup: false, subject: "Quarterly Invoice", preview: "see attached", fallbackName: "billing@x.co" } as Thread;
  const nameOf = () => "Ayesha";
  assert.ok(matchesSearch(t, "ayesha", nameOf));
  assert.ok(matchesSearch(t, "invoice", nameOf));
  assert.ok(matchesSearch(t, "attached", nameOf));
  assert.ok(!matchesSearch(t, "zebra", nameOf));
  const group = { isGroup: true, groupName: "Book Club" } as Thread;
  assert.ok(matchesSearch(group, "book", () => "ignored"));
  assert.ok(!matchesSearch(group, "ignored", () => "ignored"));
});

test("only services with two or more accounts get a name, the nickname first", () => {
  const names = accountNameMap([
    { id: "a", provider: "gmail", label: "work@x.co", nickname: "Work" },
    { id: "b", provider: "gmail", label: "home@x.co" },
    { id: "c", provider: "whatsapp", label: "+27" },
  ] as Parameters<typeof accountNameMap>[0]);
  assert.deepEqual([...names], [["a", "Work"], ["b", "home@x.co"]]);
});

const base = { priority: "normal", needsReply: false, lastFromMe: false, junk: false, status: "inbox", lastMessageAt: new Date().toISOString() } as const;

test("a row shows Urgent over Needs Reply, and no marker once you answered, or in Junk or the Archive", () => {
  assert.equal(rowMarker({ ...base, priority: "urgent", needsReply: true }), "urgent");
  assert.equal(rowMarker({ ...base, needsReply: true }), "needs_reply");
  assert.equal(rowMarker(base), null);
  assert.equal(rowMarker({ ...base, priority: "urgent", lastFromMe: true }), null);
  assert.equal(rowMarker({ ...base, needsReply: true, junk: true }), null);
  assert.equal(rowMarker({ ...base, needsReply: true, status: "archived" }), null);
});

test("Urgent fades after a day: the row falls back to Needs Reply, or to nothing", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  const at = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  assert.equal(rowMarker({ ...base, priority: "urgent", lastMessageAt: at(23) }, now), "urgent");
  assert.equal(rowMarker({ ...base, priority: "urgent", needsReply: true, lastMessageAt: at(25) }, now), "needs_reply");
  assert.equal(rowMarker({ ...base, priority: "urgent", lastMessageAt: at(25) }, now), null);
});

test("after archiving, the next row opens, else the one before, else nothing", () => {
  const order = ["a", "b", "c", "d"];
  assert.equal(advanceTarget(order, ["b"], "b"), "c");
  assert.equal(advanceTarget(order, ["d"], "d"), "c");
  assert.equal(advanceTarget(order, ["b", "c"], "b"), "d");
  assert.equal(advanceTarget(order, ["c", "d"], "c"), "b");
  assert.equal(advanceTarget(["a"], ["a"], "a"), null);
  assert.equal(advanceTarget(order, ["x"], "x"), null);
});

test("J and K step through the list and stop at its ends", () => {
  const order = ["a", "b", "c"];
  assert.equal(stepTarget(order, "a", 1), "b");
  assert.equal(stepTarget(order, "c", 1), "c");
  assert.equal(stepTarget(order, "a", -1), "a");
  assert.equal(stepTarget(order, null, 1), "a");
  assert.equal(stepTarget(order, null, -1), "c");
  assert.equal(stepTarget([], "a", 1), null);
});

test("counts leave out junk, the archive and conversations you answered", () => {
  const counts = inboxCounts([
    { ...base, unread: true },
    { ...base, unread: true, needsReply: true },
    { ...base, unread: true, junk: true },
    { ...base, unread: false, priority: "urgent" },
    { ...base, unread: false, priority: "urgent", lastFromMe: true },
  ]);
  assert.deepEqual(counts, { unread: 2, attention: 2 });
});

test("the Waiting filter explains the two day rule, other filters fall back to the view", () => {
  assert.match(emptyFor("all", "waiting").description, /2 days/);
  assert.equal(emptyFor("junk", "none").title, "No Junk");
});
