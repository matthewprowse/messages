// Tests for contacts/card-row.ts: a card's stored key is stable for the same card, keyed by the user's index key (so a
// phone-only card cannot be found by hashing every number), and apart from the address indexes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { blindIndex, deriveUserKeys, newDataKey } from "@messages/crypto";
import { addressIndex } from "@messages/crypto/addresses";
import type { Card } from "../photos/cards";
import { cardRow } from "./card-row";

const keys = await deriveUserKeys(newDataKey());
const card = (over: Partial<Card>): Card => ({ name: null, emails: [], phones: [], photo: null, ...over });

test("the same card gets the same key, however its addresses were written", async () => {
  const a = await cardRow(keys, card({ name: "Thandi", emails: ["Thandi@Example.com"], phones: ["082 555 0101"] }), "27");
  const b = await cardRow(keys, card({ name: " Thandi ", emails: ["thandi@example.com", "thandi@example.com"], phones: ["+27825550101"] }), "27");
  assert.ok(a && b);
  assert.equal(a.card_key, b.card_key);
  assert.deepEqual(a.phones, ["+27825550101"]);
});

test("a changed card gets a new key", async () => {
  const a = await cardRow(keys, card({ name: "Thandi", phones: ["+27825550101"] }), "27");
  const b = await cardRow(keys, card({ name: "Thandi M", phones: ["+27825550101"] }), "27");
  assert.notEqual(a?.card_key, b?.card_key);
});

test("a phone-only card's key needs the user's key: not the old plain hash, another user's, or an address index", async () => {
  const row = await cardRow(keys, card({ phones: ["+27825550101"] }), "27");
  assert.ok(row);
  const plain = createHash("sha256").update(JSON.stringify([null, [], ["+27825550101"]])).digest("hex").slice(0, 32);
  assert.notEqual(row.card_key, plain);
  assert.equal(row.card_key, await blindIndex(keys, `card:${JSON.stringify([null, [], ["+27825550101"]])}`));
  const other = await cardRow(await deriveUserKeys(newDataKey()), card({ phones: ["+27825550101"] }), "27");
  assert.notEqual(other?.card_key, row.card_key);
  assert.notEqual(row.card_key, await addressIndex(keys, "+27825550101"));
  assert.match(row.card_key, /^[A-Za-z0-9_-]{43}$/);
});

test("a card with no address or number is not stored", async () => {
  assert.equal(await cardRow(keys, card({ name: "Just A Name", phones: ["12"] }), "27"), null);
});
