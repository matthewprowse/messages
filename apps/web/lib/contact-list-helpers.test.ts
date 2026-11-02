// Tests for contact-list-helpers.ts: URL sort and view, ordering, and the search matching the Contacts list uses.

import assert from "node:assert/strict";
import { test } from "node:test";
import { byName, byRecent, bySort, byVipThen, detailOf, firstReach, fold, haystack, matchesQuery, plural, queryOf, sortAndView } from "./contact-list-helpers";

test("search finds words in any order and ignores accents", () => {
  const hay = haystack(["John Smith", "Zoë Müller"], []);
  assert.equal(matchesQuery("smith john", hay, ""), true);
  assert.equal(matchesQuery("zoe muller", hay, ""), true);
  assert.equal(matchesQuery(fold("ZOË"), hay, ""), true);
  assert.equal(matchesQuery("smith jane", hay, ""), false);
});

test("name sort ignores case and accents, reads numbers by value and puts bare numbers last", () => {
  const names = ["+27 82 123 4567", "émile", "Zed", "adam", "Item 10", "Item 2"].map((name) => ({ name }));
  assert.deepEqual([...names].sort(byName).map((x) => x.name), ["adam", "émile", "Item 2", "Item 10", "Zed", "+27 82 123 4567"]);
});

test("plural counts with the right word", () => {
  assert.equal(plural(1, "pair"), "1 pair");
  assert.equal(plural(2, "pair"), "2 pairs");
  assert.equal(plural(0, "address", "addresses"), "0 addresses");
});

test("the default view and sort leave the query empty", () => {
  assert.equal(queryOf("recent", "people"), "");
  assert.equal(queryOf("name", "companies"), "view=companies&sort=name");
  assert.equal(queryOf("recent", "hidden"), "view=hidden");
});

test("a relationship and the quiet days are kept in the query only when they are not the defaults", () => {
  assert.equal(queryOf("recent", "people", { rel: "Client", quiet: 30 }), "rel=Client");
  assert.equal(queryOf("recent", "quiet", { rel: "all", quiet: 60 }), "view=quiet&quiet=60");
  assert.equal(queryOf("recent", "people", { rel: "Golf Buddy", quiet: 60 }), "rel=Golf%20Buddy");
});

test("unknown sort and view params fall back to the defaults", () => {
  const p = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  assert.deepEqual(sortAndView(p({ sort: "x", view: "y" })), { sort: "recent", view: "people", query: "", rel: "all", quiet: 30 });
  assert.deepEqual(sortAndView(p({ sort: "name", view: "hidden" })), { sort: "name", view: "hidden", query: "view=hidden&sort=name", rel: "all", quiet: 30 });
  assert.deepEqual(sortAndView(p({ view: "quiet", quiet: "90", rel: "Client" })), { sort: "recent", view: "quiet", query: "view=quiet&rel=Client&quiet=90", rel: "Client", quiet: 90 });
});

test("recent puts the newest conversation first, then breaks ties by name, and no conversation sorts last", () => {
  const list = [{ name: "B", lastAt: null }, { name: "C", lastAt: "2026-02-01" }, { name: "A", lastAt: "2026-02-01" }, { name: "D", lastAt: "2026-03-01" }];
  assert.deepEqual([...list].sort(bySort("recent")).map((x) => x.name), ["D", "A", "C", "B"]);
  assert.deepEqual([...list].sort(bySort("name")).map((x) => x.name), ["A", "B", "C", "D"]);
  assert.equal(byRecent(list[0], list[0]), 0);
});

test("the first reach is an address before a number", () => {
  assert.equal(firstReach({ emails: ["a@x.com"], phones: ["+27821234567"] }), "a@x.com");
  assert.equal(firstReach({ emails: [], phones: [] }), "");
});

test("search matches text anywhere, and digits however a number is spaced", () => {
  const hay = haystack(["Ada Lovelace", null, "ada@x.com"], ["+27821234567"]);
  const digits = "27821234567";
  assert.equal(matchesQuery("", hay, digits), true);
  assert.equal(matchesQuery("lovel", hay, digits), true);
  assert.equal(matchesQuery("82 123", hay, digits), true);
  assert.equal(matchesQuery("+27 82 123", hay, digits), true);
  assert.equal(matchesQuery("12", "abc", "12345"), false); // under three digits never matches a number
  assert.equal(matchesQuery("123", "abc", "12345"), true);
  assert.equal(matchesQuery("zzz", hay, digits), false);
});

test("starred people come first whichever order is chosen", () => {
  const list = [{ name: "A", lastAt: "2026-03-01", vip: false }, { name: "Z", lastAt: null, vip: true }, { name: "M", lastAt: "2026-04-01" }];
  assert.deepEqual([...list].sort(byVipThen("recent")).map((x) => x.name), ["Z", "M", "A"]);
  assert.deepEqual([...list].sort(byVipThen("name")).map((x) => x.name), ["Z", "A", "M"]);
});

test("the line under a name is where you stand, else their work, else how to reach them", () => {
  const base = { id: "1", name: "Sam", company: "Firm", role: "Partner", emails: ["sam@firm.co.za"], phones: [], lastAt: null, isCompany: false, organizationName: null, conversationCount: 0, hasWhatsApp: false, handles: [], hasLinkedIn: false, hidden: false };
  const now = new Date(2026, 10, 12, 15);
  assert.equal(detailOf({ ...base, lastInboundAt: new Date(2026, 10, 10, 9).toISOString() }, now), "Waiting on you since Tuesday");
  assert.equal(detailOf(base, now), "Partner, Firm");
  assert.equal(detailOf({ ...base, role: null, company: null }, now), "sam@firm.co.za");
});
