// The Settings list and Search Settings (settings-list.tsx over lib/settings-index.ts): the sections a person may see
// as links, typing narrowing them to matching sections and settings, picking or pressing Enter going to the card, and
// Team showing only for someone in a team. The index's own rules are pinned in lib/settings-index.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { SettingsList } from "./settings-list";
import { fakeSupabase } from "@/test/fake-supabase";
import { renderScreen } from "@/test/render";

const nav = () => screen.getByRole("navigation", { name: "Settings" });
const search = () => screen.getByRole("searchbox", { name: "Search Settings" });

test("every section a person outside a team may see is a link to its page, without Team or Updates", () => {
  renderScreen(<SettingsList />, { path: "/settings/profile" });
  const links = within(nav()).getAllByRole("link");
  assert.deepEqual(links.map((l) => l.textContent), ["Profile", "Notifications", "Accounts", "AI", "Drafts", "Automations", "Usage", "Privacy and Data", "What's New"]);
  assert.equal(within(nav()).getByRole("link", { name: "Accounts" }).getAttribute("href"), "/settings/accounts");
});

test("typing narrows the list to matching settings, each with its section", async () => {
  const { user } = renderScreen(<SettingsList />, { path: "/settings" });
  await user.type(search(), "undo");
  const hit = within(nav()).getByRole("button", { name: /Undo Send/ });
  assert.match(hit.textContent ?? "", /Accounts/);
  assert.equal(within(nav()).queryByRole("link", { name: "Profile" }), null);
});

test("picking a setting goes to its card", async () => {
  const { user, router } = renderScreen(<SettingsList />, { path: "/settings" });
  await user.type(search(), "quiet");
  await user.click(within(nav()).getByRole("button", { name: /Quiet Hours/ }));
  assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ["/settings/notifications#push"]);
});

test("a section's own words find the section itself", async () => {
  const { user } = renderScreen(<SettingsList />, { path: "/settings" });
  await user.type(search(), "popia");
  assert.equal(within(nav()).getByRole("link", { name: "Privacy and Data" }).getAttribute("href"), "/settings/privacy");
  assert.ok(within(nav()).getByRole("button", { name: /Download My Data/ }));
});

test("Enter opens the first matching setting", async () => {
  const { user, router } = renderScreen(<SettingsList />, { path: "/settings" });
  await user.type(search(), "signatures{Enter}");
  assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ["/settings/accounts#signatures"]);
});

test("a search with no match says No Matches, and Escape brings the sections back", async () => {
  const { user } = renderScreen(<SettingsList />, { path: "/settings" });
  await user.type(search(), "zebra crossing");
  assert.ok(within(nav()).getByText("No Matches"));
  await user.type(search(), "{Escape}");
  assert.equal((search() as HTMLInputElement).value, "");
  assert.ok(within(nav()).getByRole("link", { name: "Profile" }));
});

test("settings only a team has are not found by someone outside one", async () => {
  const { user } = renderScreen(<SettingsList />, { path: "/settings" });
  await user.type(search(), "members");
  assert.ok(within(nav()).getByText("No Matches"));
});

test("someone who runs a team sees Team, and its settings are found", async () => {
  fakeSupabase.answer("from:workspaces", { data: { id: "workspace-1", strict_sharing: false }, error: null });
  fakeSupabase.answer("rpc:my_workspace_role", { data: "owner", error: null });
  const { user } = renderScreen(<SettingsList />, { path: "/settings", auth: true });
  await waitFor(() => assert.ok(within(nav()).getByRole("link", { name: "Team" })));
  await user.type(search(), "members");
  assert.ok(within(nav()).getByRole("button", { name: /Members/ }));
});
