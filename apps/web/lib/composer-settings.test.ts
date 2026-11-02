// Tests for composer-settings.ts: the stored signatures and default send-from round-trip and survive bad data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_COMPOSER, MAX_SIGNATURE, cleanSignature, hasAnySignature, parseComposer, serializeComposer, signatureFor, withDefaultFrom, withSignature } from "./composer-settings";

test("cleanSignature keeps line breaks, trims the ends and caps the length", () => {
  assert.equal(cleanSignature("\n Matt  \r\nKonva \n\n"), "Matt\nKonva");
  assert.equal(cleanSignature("x".repeat(MAX_SIGNATURE + 50)).length, MAX_SIGNATURE);
});

test("settings round-trip with lowercase addresses and no empty signatures", () => {
  let c = withSignature(EMPTY_COMPOSER, "Sales@Shop.co", "Matt\nShop");
  c = withSignature(c, "other@shop.co", "   ");
  c = withDefaultFrom(c, "Sales@Shop.co");
  const back = parseComposer(serializeComposer(c));
  assert.deepEqual(back, { signatures: { "sales@shop.co": "Matt\nShop" }, defaultFrom: "sales@shop.co" });
  assert.equal(signatureFor(back, " SALES@shop.co "), "Matt\nShop");
  assert.equal(signatureFor(back, "other@shop.co"), "");
  assert.equal(hasAnySignature(back), true);
});

test("clearing a signature or the default removes it", () => {
  const c = withDefaultFrom(withSignature(EMPTY_COMPOSER, "a@b.co", "Hi"), "a@b.co");
  assert.deepEqual(withSignature(c, "a@b.co", ""), { signatures: {}, defaultFrom: "a@b.co" });
  assert.deepEqual(withDefaultFrom(c, undefined), { signatures: { "a@b.co": "Hi" } });
  assert.equal(hasAnySignature(withSignature(c, "a@b.co", "")), false);
});

test("unreadable stored data gives empty settings", () => {
  for (const bad of [null, "", "nope", "[]", '{"signatures":5}', '{"signatures":{"a@b.co":7}}']) assert.deepEqual(parseComposer(bad), EMPTY_COMPOSER);
});
