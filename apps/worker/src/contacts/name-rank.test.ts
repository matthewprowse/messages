// Tests for contacts/name-rank.ts: the kind of name each writer stores with a sealed name, which the database decides
// by instead of reading the name (contacts.display_name_rank).

import { test } from "node:test";
import assert from "node:assert/strict";
import { emailNameRank, fullerName, givenNameRank, REAL_NAME, SELF_SET, STAND_IN, whatsappName } from "./name-rank";

test("an email sender's own name is real; one made from the address or company, or only 'No Reply', is a stand-in", () => {
  assert.equal(emailNameRank("sipho@example.co.za", "Sipho Dlamini", "Sipho Dlamini"), REAL_NAME);
  assert.equal(emailNameRank("sipho@example.co.za", "  Sipho Dlamini ", "Sipho Dlamini"), REAL_NAME);
  assert.equal(emailNameRank("sipho.dlamini@example.co.za", null, "Sipho Dlamini"), STAND_IN);
  assert.equal(emailNameRank("noreply@bank.co.za", "No Reply", "Bank"), STAND_IN);
  assert.equal(emailNameRank("noreply@bank.co.za", "No Reply", "No Reply"), STAND_IN);
  assert.equal(emailNameRank("x@example.com", "x@example.com", "x@example.com"), STAND_IN);
  // "Max via LinkedIn" is filed under the company, so the stored name is not the header's.
  assert.equal(emailNameRank("messages@linkedin.com", "Max Bishop via LinkedIn", "LinkedIn"), STAND_IN);
});

test("a provider's name is real unless it is missing, a number or an address", () => {
  assert.equal(givenNameRank("Thandi Nkosi"), REAL_NAME);
  assert.equal(givenNameRank(""), STAND_IN);
  assert.equal(givenNameRank(null), STAND_IN);
  assert.equal(givenNameRank("+27 82 123 4567"), STAND_IN);
  assert.equal(givenNameRank("thandi@konva.co.za"), STAND_IN);
});

test("WhatsApp: a saved name beats the person's own, which beats their number", () => {
  assert.deepEqual(whatsappName("Mom", "Thandi", "+27821234567"), { name: "Mom", rank: REAL_NAME });
  assert.deepEqual(whatsappName(null, "Thandi", "+27821234567"), { name: "Thandi", rank: SELF_SET });
  assert.deepEqual(whatsappName("  ", undefined, "+27821234567"), { name: "+27821234567", rank: STAND_IN });
});

test("after a merge a full name replaces a one-word one, and nothing replaces a full name or uses a stand-in", () => {
  assert.equal(fullerName("Geoff", "Geoff Prowse"), "Geoff Prowse");
  assert.equal(fullerName("Geoff Prowse", "Geoff"), null);
  assert.equal(fullerName("Geoff Prowse", "Geoffrey Prowse"), null);
  assert.equal(fullerName("+27821234567", "Geoff Prowse"), null); // the database's rank already picks the real name
  assert.equal(fullerName("Geoff", "geoff@example.com"), null);
});
