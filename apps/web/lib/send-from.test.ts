import { test } from "node:test";
import assert from "node:assert/strict";
import type { Contact, Message } from "./types";
import { defaultFrom, parseAddresses, replyRecipients, sendAddressesOf } from "./send-from";

const account = { detail: "Me@Example.com", sendAddresses: ["me@example.com", "hello@shop.co", " Sales@Shop.co "] };

function msg(p: Partial<Message>): Message {
  return { id: Math.random().toString(), threadId: "t", from: "c1", sentAt: "2026-10-22T10:00:00Z", body: "", ...p };
}

const jane: Contact = { id: "c1", name: "Jane", initials: "J", hue: 0, emails: ["jane@x.com", "me@example.com"], phones: ["+447700900000"] };

test("sendAddressesOf puts the account address first, lowercased and deduped", () => {
  assert.deepEqual(sendAddressesOf(account), ["me@example.com", "hello@shop.co", "sales@shop.co"]);
});

test("defaultFrom uses the address the latest inbound email was sent to", () => {
  const msgs = [msg({ toAddresses: ["sales@shop.co"] }), msg({ toAddresses: ["friend@x.com", "Hello@Shop.co"] }), msg({ from: "me" })];
  assert.equal(defaultFrom(account, msgs), "hello@shop.co");
});

test("defaultFrom falls back to the account address", () => {
  assert.equal(defaultFrom(account, [msg({ toAddresses: ["other@x.com"] })]), "me@example.com");
  assert.equal(defaultFrom(account, [msg({ toAddresses: ["sales@shop.co"] }), msg({})]), "me@example.com");
  assert.equal(defaultFrom(account, []), "me@example.com");
});

test("replyRecipients answers the latest sender who is not you", () => {
  const msgs = [msg({ address: "jane@x.com" }), msg({ from: "c2", address: "me@example.com" })];
  assert.deepEqual(replyRecipients("email", msgs, [jane], sendAddressesOf(account)), [{ contactId: "c1", address: "jane@x.com" }]);
});

test("replyRecipients falls back to participants, skipping your own addresses", () => {
  assert.deepEqual(replyRecipients("email", [msg({ from: "me" })], [jane], sendAddressesOf(account)), [{ contactId: "c1", address: "jane@x.com" }]);
  assert.deepEqual(replyRecipients("whatsapp", [], [jane], []), [{ contactId: "c1", address: "+447700900000" }]);
});

test("replyRecipients answers the latest sender when everyone is you", () => {
  const msgs = [msg({ from: "me", address: "me@gmail.com" })];
  assert.deepEqual(replyRecipients("email", msgs, [], sendAddressesOf(account)), [{ contactId: undefined, address: "me@gmail.com" }]);
});

test("parseAddresses splits, lowercases and flags bad entries", () => {
  assert.deepEqual(parseAddresses("Jane@X.com, bob@y.co; <amy@z.io>  jane@x.com, nope"), {
    valid: ["jane@x.com", "bob@y.co", "amy@z.io"],
    invalid: ["nope"],
  });
});

test("defaultFrom in a conversation you started uses the address you sent from", () => {
  assert.equal(defaultFrom(account, [msg({ from: "me", address: "Hello@Shop.co" })]), "hello@shop.co");
  assert.equal(defaultFrom(account, [msg({ from: "me", address: "old@elsewhere.com" })]), "me@example.com");
});

test("parseAddresses reads pasted names and matches the worker's rules", () => {
  assert.deepEqual(parseAddresses('Jane Doe <jane@x.com>, "Doe, Bob" <bob@y.co>'), { valid: ["jane@x.com", "bob@y.co"], invalid: [] });
  assert.deepEqual(parseAddresses('jane@x..com, a"b@x.com'), { valid: [], invalid: ["jane@x..com", 'a"b@x.com'] });
});

test("defaultFrom skips a reply still sending", () => {
  const msgs = [msg({ toAddresses: ["hello@shop.co"] }), msg({ from: "me", address: "sales@shop.co", sendState: "sending" })];
  assert.equal(defaultFrom(account, msgs), "hello@shop.co");
});
