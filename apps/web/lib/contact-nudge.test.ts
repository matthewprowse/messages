// Tests for lib/contact-nudge.ts: the title, the due day and the account a reminder is made in.

import test from "node:test";
import assert from "node:assert/strict";
import { firstNameOf, nudgeAccount, nudgeForm } from "./contact-nudge";

test("a real name gives its first word and a number or address stays whole", () => {
  assert.equal(firstNameOf("Sipho Dlamini"), "Sipho");
  assert.equal(firstNameOf("+27 82 123 4567"), "+27 82 123 4567");
  assert.equal(firstNameOf("sam@firm.co.za"), "sam@firm.co.za");
  assert.equal(firstNameOf("  "), "Them");
});

test("the form is an all day task due that many days from today", () => {
  const form = nudgeForm("Sipho Dlamini", "acc", 14, new Date(2026, 10, 12, 15, 30));
  assert.deepEqual(form, { title: "Check In With Sipho", notes: "", accountId: "acc", date: "2026-11-26", time: "", priority: 0 });
});

test("the account is the first connected one that takes tasks", () => {
  const accounts = [
    { id: "mail", provider: "gmail" as const, status: "connected" as const },
    { id: "old", provider: "google_tasks" as const, status: "disconnected" as const },
    { id: "todo", provider: "microsoft_todo" as const, status: "connected" as const },
  ];
  assert.equal(nudgeAccount(accounts)?.id, "todo");
  assert.equal(nudgeAccount(accounts.slice(0, 2)), undefined);
});
