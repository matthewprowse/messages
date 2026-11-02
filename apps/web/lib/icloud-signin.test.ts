// Tests for the one iCloud sign-in's rules: the Mail sign-in name and the ticked services.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chosenServices, connectedMessage, isICloudAddress, mailLogin, untaken } from "./icloud-signin";

test("Apple's own addresses are iCloud Mail addresses", () => {
  assert.equal(isICloudAddress("Name@iCloud.com"), true);
  assert.equal(isICloudAddress("name@me.com"), true);
  assert.equal(isICloudAddress("name@mac.com "), true);
  assert.equal(isICloudAddress("name@gmail.com"), false);
});

test("Mail signs in with the typed iCloud address, else the Apple ID when it is one", () => {
  assert.equal(mailLogin("Name@iCloud.com", ""), "name@icloud.com");
  assert.equal(mailLogin("name@gmail.com", " Me@iCloud.com "), "me@icloud.com");
  assert.equal(mailLogin("name@gmail.com", ""), null);
  assert.equal(mailLogin("name@icloud.com", "not an address"), null);
});

test("services keep a fixed order and need at least one", () => {
  assert.deepEqual(chosenServices({ reminders: true, mail: true }), ["mail", "reminders"]);
  assert.deepEqual(chosenServices({ calendar: true }), ["calendar"]);
  assert.equal(chosenServices({ mail: false, calendar: "yes" }), null);
});

test("the connected message names what was connected", () => {
  assert.equal(connectedMessage({ mail: true, calendar: true, reminders: false }), "iCloud Mail and Calendar are connected.");
  assert.equal(connectedMessage({ mail: true, calendar: false, reminders: true }, { mail: true, calendar: true }), "iCloud Mail is connected. Calendar did not accept the same sign-in. Reminders is signing in.");
  assert.equal(connectedMessage({ mail: false, calendar: false, reminders: true }), "Reminders is signing in.");
});

test("a sign-in nobody picked up within 45 seconds counts as untaken", () => {
  const at = Date.parse("2026-11-02T19:33:46Z");
  assert.equal(untaken("2026-11-02T19:33:46.130641+00:00", at + 30_000), false);
  assert.equal(untaken("2026-11-02T19:33:46.130641+00:00", at + 60_000), true);
});
