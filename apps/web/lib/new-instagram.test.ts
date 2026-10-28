// Tests for new-instagram.ts: username cleanup, spotting the official Instagram account, and picking the linked accounts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { instagramAccounts, instagramLinked, instagramUsername, isOfficialAccount, normaliseUsername } from "./new-instagram";
import type { Account } from "./types";

const account = (id: string, label: string, status: Account["status"] = "connected", provider: Account["provider"] = "instagram") =>
  ({ id, provider, label, status }) as Pick<Account, "provider" | "label" | "status"> & { id: string };

test("normaliseUsername drops the @, spaces, case and profile links", () => {
  assert.equal(normaliseUsername("  @Ana.M "), "ana.m");
  assert.equal(normaliseUsername("https://www.instagram.com/Ana.M/"), "ana.m");
  assert.equal(normaliseUsername("instagram.com/ana.m?hl=en"), "ana.m");
});

test("instagramUsername accepts only what Instagram allows", () => {
  assert.equal(instagramUsername("@ben_k"), "ben_k");
  assert.equal(instagramUsername("a"), "a");
  assert.equal(instagramUsername(""), null);
  assert.equal(instagramUsername("two words"), null);
  assert.equal(instagramUsername("ana-m"), null);
  assert.equal(instagramUsername("a".repeat(31)), null);
});

test("official accounts are told apart by their label", () => {
  assert.equal(isOfficialAccount(account("a", "Instagram Professional")), true);
  assert.equal(isOfficialAccount(account("a", "Instagram")), false);
});

test("instagramAccounts keeps connected Instagram accounts, personal first", () => {
  const list = [
    account("pro", "Instagram Professional"),
    account("off", "Instagram", "disconnected"),
    account("wa", "WhatsApp", "connected", "whatsapp"),
    account("me", "Instagram", "syncing"),
  ];
  assert.deepEqual(instagramAccounts(list).map((a) => (a as { id: string }).id), ["me", "pro"]);
  assert.equal(instagramLinked(list), true);
  assert.equal(instagramLinked([account("off", "Instagram", "error")]), false);
});
