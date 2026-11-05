// The Attachments Filter menu (attachments/filter-menu.tsx): the button names what is on (or counts it), each group
// reports its choice, Show Hidden toggles, and Clear Filters is only offered once something is on.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { screen } from "@testing-library/react";
import { activeFilterNames, FilterMenu, type FileFilters } from "./filter-menu";
import { renderScreen } from "@/test/render";

const SOURCES = [{ key: "gmail", label: "Gmail" }, { key: "whatsapp", label: "WhatsApp" }];
const AT_REST: FileFilters = { source: "all", date: "any", doc: "all", sort: "newest", hidden: false };

function renderMenu(value: Partial<FileFilters> = {}) {
  const onChange = mock.fn((_: Partial<FileFilters>) => undefined);
  const onClear = mock.fn();
  const s = renderScreen(<FilterMenu value={{ ...AT_REST, ...value }} sources={SOURCES} onChange={onChange} onClear={onClear} />, { path: "/attachments" });
  return { ...s, onChange, onClear };
}

/** Opens the menu from whatever the button is called now. */
async function open(user: ReturnType<typeof renderMenu>["user"]) {
  await user.click(screen.getByRole("button", { name: /^Filter/ }));
  await screen.findByRole("menu");
}

test("at rest the button is a plain Filter icon and Clear Filters is off", async () => {
  const { user } = renderMenu();
  assert.ok(screen.getByRole("button", { name: "Filter" }));
  await open(user);
  assert.equal(screen.getByRole("menuitem", { name: "Clear Filters" }).getAttribute("aria-disabled"), "true");
});

test("one filter on names the button after it; two read as 2 Filters", () => {
  const { unmount } = renderMenu({ source: "whatsapp" });
  assert.ok(screen.getByRole("button", { name: "Filter, WhatsApp" }));
  unmount();
  renderMenu({ date: "week", doc: "invoice" });
  assert.ok(screen.getByRole("button", { name: "Filter, 2 Filters" }));
});

test("picking a source, a date, a document kind and a sort each reports just that change", async () => {
  const { user, onChange } = renderMenu();
  for (const name of ["Gmail", "Past Month", "Invoices", "Largest"]) {
    await open(user);
    await user.click(screen.getByRole("menuitemradio", { name }));
  }
  assert.deepEqual(onChange.mock.calls.map((c) => c.arguments[0]), [{ source: "gmail" }, { date: "month" }, { doc: "invoice" }, { sort: "largest" }]);
});

test("the current choice in each group is the checked one", async () => {
  const { user } = renderMenu({ source: "gmail", sort: "largest" });
  await open(user);
  assert.equal(screen.getByRole("menuitemradio", { name: "Gmail" }).getAttribute("aria-checked"), "true");
  assert.equal(screen.getByRole("menuitemradio", { name: "All Sources" }).getAttribute("aria-checked"), "false");
  assert.equal(screen.getByRole("menuitemradio", { name: "Largest" }).getAttribute("aria-checked"), "true");
});

test("Show Hidden turns on hidden files", async () => {
  const { user, onChange } = renderMenu();
  await open(user);
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Show Hidden" }));
  assert.deepEqual(onChange.mock.calls.map((c) => c.arguments[0]), [{ hidden: true }]);
});

test("Clear Filters clears once something is on", async () => {
  const { user, onClear } = renderMenu({ hidden: true });
  await open(user);
  await user.click(screen.getByRole("menuitem", { name: "Clear Filters" }));
  assert.equal(onClear.mock.callCount(), 1);
});

test("the names follow the menu's order, and a source not in the list keeps its key", () => {
  assert.deepEqual(activeFilterNames({ source: "outlook", date: "year", doc: "quote", sort: "largest", hidden: true }, SOURCES), ["outlook", "Past Year", "Quotes", "Largest", "Show Hidden"]);
  assert.deepEqual(activeFilterNames(AT_REST, SOURCES), []);
});
