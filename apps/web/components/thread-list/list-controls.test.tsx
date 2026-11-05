// The Conversations list's controls (list-controls.tsx): the view buttons and their links, the Priority unread count, and
// the Filter menu, which offers only the channels you have, names the active filter, and switches By Person.

import { test } from "node:test";
import assert from "node:assert/strict";
import { screen, within } from "@testing-library/react";
import { FilterButton, ListControls } from "./list-controls";
import { renderScreen } from "@/test/render";
import { GARDEN, LABELS, LEASE, THREADS } from "@/test/fixtures";

const replaced = (router: { replace: { mock: { calls: { arguments: unknown[] }[] } } }) => router.replace.mock.calls.map((c) => c.arguments[0]);

test("the view buttons link to each view, keep the filter, and mark the one showing", () => {
  renderScreen(<ListControls view="all" filter="unread" />);
  const nav = screen.getByRole("navigation", { name: "View" });
  const all = within(nav).getByRole("link", { name: "All" });
  assert.equal(all.getAttribute("aria-current"), "page");
  assert.equal(within(nav).getByRole("link", { name: /^Junk/ }).getAttribute("href"), "/inbox?view=junk&filter=unread");
  assert.deepEqual(within(nav).getAllByRole("link").map((a) => a.textContent), ["All", "Priority1", "Junk", "Subscriptions", "Archive", "Snoozed", "Deleted"]);
});

test("Priority counts its unread conversations", () => {
  const { store } = renderScreen(<ListControls view="all" filter="none" />);
  assert.ok(store.listThreads.mock.calls.some((c) => c.arguments[0] === "priority" && c.arguments[1] === "unread"));
  assert.match(screen.getByRole("link", { name: /^Priority/ }).textContent ?? "", /1$/);
});

test("a label that no longer exists is dropped from the links", () => {
  renderScreen(<ListControls view="all" filter="none" label="label-gone" />, { labels: LABELS });
  assert.equal(screen.getByRole("link", { name: "Archive" }).getAttribute("href"), "/inbox?view=archive");
});

test("the Filter menu lists the channels you have and picking one replaces the address", async () => {
  const { user, router } = renderScreen(<FilterButton view="all" filter="none" />);
  await user.click(screen.getByRole("button", { name: "Filter" }));
  const options = (await screen.findAllByRole("menuitemradio")).map((o) => o.textContent);
  assert.deepEqual(options, ["No Filter", "Unread", "Email", "WhatsApp", "Waiting"]);
  await user.click(screen.getByRole("menuitemradio", { name: "WhatsApp" }));
  assert.deepEqual(replaced(router), ["/inbox?filter=whatsapp"]);
});

test("with one channel there is no channel to pick between", async () => {
  const { user } = renderScreen(<FilterButton view="all" filter="none" />, { threads: [LEASE, GARDEN] });
  await user.click(screen.getByRole("button", { name: "Filter" }));
  const options = (await screen.findAllByRole("menuitemradio")).map((o) => o.textContent);
  assert.deepEqual(options, ["No Filter", "Unread", "Waiting"]);
});

test("an active filter names itself on the button", () => {
  renderScreen(<FilterButton view="all" filter="unread" />);
  assert.ok(screen.getByRole("button", { name: "Filter, Unread" }));
});

test("a filter and By Person together read 2 Filters", () => {
  renderScreen(<FilterButton view="all" filter="unread" byPerson />);
  assert.ok(screen.getByRole("button", { name: "Filter, 2 Filters" }));
});

test("By Person turns on in the address, and off again", async () => {
  const first = renderScreen(<FilterButton view="all" filter="none" />, { threads: THREADS });
  await first.user.click(screen.getByRole("button", { name: "Filter" }));
  await first.user.click(await screen.findByRole("menuitemcheckbox", { name: "By Person" }));
  assert.deepEqual(replaced(first.router), ["/inbox?group=person"]);
  first.unmount();
  const second = renderScreen(<FilterButton view="all" filter="none" byPerson />);
  await second.user.click(screen.getByRole("button", { name: "Filter, By Person" }));
  await second.user.click(await screen.findByRole("menuitemcheckbox", { name: "By Person" }));
  assert.deepEqual(replaced(second.router), ["/inbox"]);
});

test("Subscriptions offers only Unread and no By Person", async () => {
  const { user } = renderScreen(<FilterButton view="subscriptions" filter="none" />);
  await user.click(screen.getByRole("button", { name: "Filter" }));
  const options = (await screen.findAllByRole("menuitemradio")).map((o) => o.textContent);
  assert.deepEqual(options, ["No Filter", "Unread"]);
  assert.equal(screen.queryByRole("menuitemcheckbox", { name: "By Person" }), null);
});
