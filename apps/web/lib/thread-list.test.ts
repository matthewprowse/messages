// Tests for thread-list.ts: list links that drop defaults, address parsing, search matching and which accounts get a name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { accountNameMap, filterOf, listHref, matchesSearch, viewOf, withQuery } from "./thread-list";
import type { Thread } from "./types";

test("a link leaves out the default view and a filter the view does not offer", () => {
  assert.equal(listHref("all", "none"), "/inbox");
  assert.equal(listHref("priority", "unread"), "/inbox?view=priority&filter=unread");
  assert.equal(listHref("subscriptions", "whatsapp"), "/inbox?view=subscriptions");
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
  assert.equal(filterOf("nonsense"), "none");
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
