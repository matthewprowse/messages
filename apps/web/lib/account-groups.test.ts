// Tests for account-groups.ts: parts of one Google, Microsoft or iCloud sign-in group into one row, other services stay apart,
// and a group's status and problem text come from its parts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { attentionFirst, groupAccounts, groupProblem, groupStatus, partsOf, setupHrefOf, summariseGroups } from "./account-groups";
import type { Account } from "./types";

const acct = (id: string, provider: Account["provider"], status: Account["status"] = "connected", statusDetail?: string): Account =>
  ({ id, provider, label: provider, detail: "", status, statusDetail, sendAddresses: [] });

test("one sign-in's parts are one group, other services stay apart", () => {
  const groups = groupAccounts([acct("1", "gmail"), acct("2", "google_calendar"), acct("3", "google_tasks"), acct("4", "whatsapp"), acct("5", "icloud"), acct("6", "icloud_reminders")]);
  assert.deepEqual(groups.map((g) => [g.family, g.accounts.map((a) => a.id)]), [["google", ["1", "2", "3"]], ["whatsapp", ["4"]], ["apple", ["5", "6"]]]);
  assert.equal(partsOf(groups[0]), "Gmail, Calendar, Tasks");
});

test("two Google sign-ins pair their parts in order", () => {
  const groups = groupAccounts([acct("1", "gmail"), acct("2", "gmail"), acct("3", "google_calendar"), acct("4", "google_calendar")]);
  assert.deepEqual(groups.map((g) => g.accounts.map((a) => a.id)), [["1", "3"], ["2", "4"]]);
});

test("a part needing attention shows for the whole sign-in, with what it said", () => {
  const [g] = groupAccounts([acct("1", "gmail"), acct("2", "google_tasks", "error", "Turn on the API.")]);
  assert.equal(groupStatus(g), "error");
  assert.equal(groupProblem(g), "Tasks: Turn on the API.");
  assert.equal(groupStatus({ ...g, accounts: [acct("1", "gmail", "disconnected")] }), "disconnected");
});

test("sign-ins that need attention come first, and the summary counts working ones", () => {
  const groups = groupAccounts([acct("1", "whatsapp"), acct("2", "imap", "error", "Wrong password."), acct("3", "linkedin", "disconnected")]);
  assert.deepEqual(attentionFirst(groups).map((g) => g.accounts[0].id), ["2", "1", "3"]);
  assert.deepEqual(summariseGroups(groups), { working: 1, total: 3, attention: 1 });
});

test("each sign-in has one connect page", () => {
  const [google, wa] = groupAccounts([acct("1", "gmail"), acct("2", "whatsapp")]);
  assert.equal(setupHrefOf(google), "/settings/accounts/google");
  assert.equal(setupHrefOf(wa), "/settings/accounts/whatsapp");
});
