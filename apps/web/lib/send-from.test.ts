// Tests for send-from.ts: default send-from address, parsing address lists, and reply and reply-all recipients without
// including yourself.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Contact, Message } from "./types";
import { defaultFrom, parseAddresses, replyAllRecipients, replyRecipients, sendAddressesOf } from "./send-from";

const account = { detail: "Me@Example.com", sendAddresses: ["me@example.com", "hello@shop.co", " Sales@Shop.co "] };

function msg(p: Partial<Message>): Message {
  return { id: Math.random().toString(), threadId: "t", from: "c1", sentAt: "2026-10-22T10:00:00Z", body: "", ...p };
}

const jane: Contact = { id: "c1", name: "Jane", initials: "J", hue: 0, emails: ["jane@x.com", "me@example.com"], phones: ["+447700900000"], isCompany: false };

test("sendAddressesOf puts the account address first, lowercased and deduped", () => {
  assert.deepEqual(sendAddressesOf(account), ["me@example.com", "hello@shop.co", "sales@shop.co"]);
});

test("defaultFrom uses the address the latest inbound email was sent to", () => {
  const msgs = [msg({ toAddresses: ["sales@shop.co"] }), msg({ toAddresses: ["friend@x.com", "Hello@Shop.co"] }), msg({ from: "me" })];
  assert.equal(defaultFrom(account, msgs), "hello@shop.co");
});

test("defaultFrom uses the default set in Settings when no email decides, and ignores one that is gone", () => {
  assert.equal(defaultFrom(account, [msg({ toAddresses: ["other@x.com"] })], "Sales@Shop.co"), "sales@shop.co");
  assert.equal(defaultFrom(account, [msg({ toAddresses: ["hello@shop.co"] })], "sales@shop.co"), "hello@shop.co");
  assert.equal(defaultFrom(account, [], "removed@x.com"), "me@example.com");
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

test("replyAllRecipients sends to the sender and copies everyone else, minus your own addresses", () => {
  const msgs = [msg({ address: "Jane@x.com", toAddresses: ["me@example.com", "bob@y.co", "amy@z.io", "jane@x.com"] })];
  assert.deepEqual(replyAllRecipients(msgs, sendAddressesOf(account)), { to: ["jane@x.com"], cc: ["bob@y.co", "amy@z.io"] });
});

test("replyAllRecipients answers the latest message from someone else, skipping replies still sending", () => {
  const msgs = [
    msg({ address: "jane@x.com", toAddresses: ["me@example.com", "bob@y.co"] }),
    msg({ from: "me", address: "me@example.com", toAddresses: ["jane@x.com", "bob@y.co"] }),
    msg({ address: "late@x.com", toAddresses: ["me@example.com"], sendState: "sending" }),
  ];
  assert.deepEqual(replyAllRecipients(msgs, sendAddressesOf(account)), { to: ["jane@x.com"], cc: ["bob@y.co"] });
});

test("replyAllRecipients on a chosen message answers that one, and on your own email goes to its recipients", () => {
  const theirs = msg({ address: "jane@x.com", toAddresses: ["me@example.com", "bob@y.co"] });
  const mine = msg({ from: "me", address: "me@example.com", toAddresses: ["Jane@x.com", "bob@y.co", "hello@shop.co"] });
  assert.deepEqual(replyAllRecipients([theirs, mine], sendAddressesOf(account), theirs), { to: ["jane@x.com"], cc: ["bob@y.co"] });
  assert.deepEqual(replyAllRecipients([theirs, mine], sendAddressesOf(account), mine), { to: ["jane@x.com", "bob@y.co"], cc: [] });
});

test("replyAllRecipients has no one to fill in when there is nothing to answer", () => {
  assert.deepEqual(replyAllRecipients([], sendAddressesOf(account)), { to: [], cc: [] });
  assert.deepEqual(replyAllRecipients([msg({ from: "me" })], sendAddressesOf(account)), { to: [], cc: [] });
});
