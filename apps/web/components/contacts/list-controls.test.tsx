// The Contacts list controls (contacts/list-controls.tsx): the Filter menu names what is on and reports each choice, the
// Going Quiet days take the sort's place there, the line under a name picks the most useful fact, and "/" focuses search.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { useRef } from "react";
import { screen } from "@testing-library/react";
import { ContactsFilter, factOf, mainProviders, useSlashFocus } from "./list-controls";
import { renderScreen } from "@/test/render";
import { thread } from "@/test/fixtures";
import type { Sort, View } from "@/lib/contact-list-helpers";

/** The filter with every choice reported to a spy. */
function renderFilter({ view = "people", sort = "recent", rel = "all", quiet = 30, contacts = [{ relationship: "Client" }] }: { view?: View; sort?: Sort; rel?: string; quiet?: number; contacts?: { relationship?: string }[] } = {}) {
  const onSort = mock.fn((_: Sort) => undefined);
  const onRel = mock.fn((_: string) => undefined);
  const onQuiet = mock.fn((_: number) => undefined);
  const s = renderScreen(<ContactsFilter view={view} sort={sort} rel={rel} quiet={quiet} contacts={contacts} onSort={onSort} onRel={onRel} onQuiet={onQuiet} />);
  return { ...s, onSort, onRel, onQuiet };
}

test("at rest the filter is a plain icon named Filter", () => {
  renderFilter();
  assert.ok(screen.getByRole("button", { name: "Filter" }));
});

test("sorting by name is reported, and once on the button says By Name", async () => {
  const { user, onSort, unmount } = renderFilter();
  await user.click(screen.getByRole("button", { name: "Filter" }));
  await user.click(await screen.findByRole("menuitemradio", { name: "Name" }));
  assert.deepEqual(onSort.mock.calls.map((c) => c.arguments), [["name"]]);
  unmount();
  renderFilter({ sort: "name" });
  assert.ok(screen.getByRole("button", { name: "Filter, By Name" }));
});

test("a relationship can be chosen, and two filters on read as 2 Filters", async () => {
  const { user, onRel, unmount } = renderFilter();
  await user.click(screen.getByRole("button", { name: "Filter" }));
  assert.ok(await screen.findByRole("menuitemradio", { name: "All Relationships" }));
  await user.click(screen.getByRole("menuitemradio", { name: "Client" }));
  assert.deepEqual(onRel.mock.calls.map((c) => c.arguments), [["Client"]]);
  unmount();
  renderFilter({ sort: "name", rel: "Client" });
  assert.ok(screen.getByRole("button", { name: "Filter, 2 Filters" }));
});

test("on Going Quiet the menu offers days instead of a sort", async () => {
  const { user, onQuiet } = renderFilter({ view: "quiet" });
  await user.click(screen.getByRole("button", { name: "Filter" }));
  await user.click(await screen.findByRole("menuitemradio", { name: "60 Days" }));
  assert.deepEqual(onQuiet.mock.calls.map((c) => c.arguments), [[60]]);
  assert.equal(screen.queryByRole("menuitemradio", { name: "Name" }), null);
});

test("Companies get the sort alone, with no relationship", async () => {
  const { user } = renderFilter({ view: "companies" });
  await user.click(screen.getByRole("button", { name: "Filter" }));
  assert.ok(await screen.findByRole("menuitemradio", { name: "Recent" }));
  assert.equal(screen.queryByRole("menuitemradio", { name: "All Relationships" }), null);
});

test("the line under a name is the company, else the role, else a number or address", () => {
  const base = { company: null, organizationName: null, role: null, phones: [] as string[], handles: [] as string[], emails: ["ava.thompson@example.com"] };
  assert.equal(factOf({ ...base, company: "Thompson Interiors", role: "Director" }), "Thompson Interiors");
  assert.equal(factOf({ ...base, role: "Director" }), "Director");
  assert.equal(factOf({ ...base, handles: ["ava.designs"] }), "@ava.designs");
  assert.equal(factOf(base), "ava.thompson@example.com");
});

test("a person's badge is the service of their newest one-to-one chat; groups do not count", () => {
  const map = mainProviders([
    thread("a", { participantIds: ["p1"], provider: "gmail", lastMessageAt: "2026-11-01T10:00:00Z" }),
    thread("b", { participantIds: ["p1"], provider: "whatsapp", lastMessageAt: "2026-11-02T10:00:00Z" }),
    thread("c", { participantIds: ["p2"], provider: "linkedin", isGroup: true }),
  ]);
  assert.equal(map.get("p1"), "whatsapp");
  assert.equal(map.has("p2"), false);
});

test("pressing / focuses search, but not while typing in another field", async () => {
  function Harness() {
    const ref = useRef<HTMLInputElement>(null);
    useSlashFocus(ref);
    return <><input aria-label="Search Contacts" ref={ref} /><input aria-label="Other Field" /></>;
  }
  const { user } = renderScreen(<Harness />);
  const search = screen.getByRole("textbox", { name: "Search Contacts" });
  // happy-dom lays nothing out, so offsetParent is null; the hook reads it to skip a hidden box.
  Object.defineProperty(search, "offsetParent", { get: () => document.body });
  await user.keyboard("/");
  assert.equal(document.activeElement, search);
  await user.click(screen.getByRole("textbox", { name: "Other Field" }));
  await user.keyboard("/");
  assert.equal(document.activeElement, screen.getByRole("textbox", { name: "Other Field" }));
  assert.equal((search as HTMLInputElement).value, "");
});
