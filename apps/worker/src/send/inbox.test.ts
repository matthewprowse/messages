import { test } from "node:test";
import assert from "node:assert/strict";
import { mayUseAccount, replyFor } from "./inbox";

test("the conversation's own person always replies for themselves", () => {
  assert.equal(replyFor("agent", "agent", false), "owner");
  assert.equal(replyFor("agent", "agent", true), "owner");
});

test("someone else replies only from the inbox's access list", () => {
  assert.equal(replyFor("admin", "member", true), "inbox");
  assert.equal(replyFor("admin", "member", false), "nobody");
});

test("an account sends for its own person or for a shared inbox member, never for anyone else", () => {
  assert.equal(mayUseAccount("admin", "admin", "owner"), true);
  assert.equal(mayUseAccount("admin", "member", "inbox"), true);
  assert.equal(mayUseAccount("admin", "member", "nobody"), false);
  assert.equal(mayUseAccount("admin", "member", "owner"), false, "a row for the owner's conversation by someone else is not the owner's");
});
