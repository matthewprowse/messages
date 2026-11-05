// icloud-mail.ts: what the iCloud form starts with, and which account a new app-specific password reconnects.

import assert from "node:assert/strict";
import { test } from "node:test";
import { accountForSignIn, icloudPrefill, isFreeMail } from "./icloud-mail";

test("an Apple address starts the form as the iCloud sign-in", () => {
  assert.deepEqual(icloudPrefill("Name@iCloud.com"), { username: "Name@iCloud.com", address: "" });
  assert.deepEqual(icloudPrefill("name@me.com"), { username: "name@me.com", address: "" });
});

test("an address on a domain of your own is taken for iCloud+", () => {
  assert.deepEqual(icloudPrefill("matthew@prowse.co.za"), { username: "", address: "matthew@prowse.co.za" });
});

test("a free mail address is never put forward as the address people email you at", () => {
  assert.deepEqual(icloudPrefill("someone@gmail.com"), { username: "", address: "" });
  assert.deepEqual(icloudPrefill("someone@Outlook.com"), { username: "", address: "" });
  assert.deepEqual(icloudPrefill(""), { username: "", address: "" });
  assert.equal(isFreeMail(" a@yahoo.com "), true);
  assert.equal(isFreeMail("a@prowse.co.za"), false);
});

test("a new password reconnects the oldest account with the same sign-in, whatever its address", () => {
  const accounts = [
    { id: "copy", createdAt: "2026-11-04T12:38:00Z", username: "me@gmail.com" },
    { id: "other", createdAt: "2026-10-01T00:00:00Z", username: "else@icloud.com" },
    { id: "first", createdAt: "2026-10-22T18:20:00Z", username: "Me@Gmail.com" },
  ];
  assert.equal(accountForSignIn(accounts, " me@gmail.com")?.id, "first");
  assert.equal(accountForSignIn(accounts, "else@icloud.com")?.id, "other");
});

test("no account with that sign-in, or one whose sign-in would not open, means none to reconnect", () => {
  assert.equal(accountForSignIn([{ id: "a", createdAt: "2026-10-22T00:00:00Z", username: null }], "me@gmail.com"), null);
  assert.equal(accountForSignIn([], "me@gmail.com"), null);
});
