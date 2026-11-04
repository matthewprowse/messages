// Tests for send/outbox-open.ts: an outbox row opens only when its body, subject and addresses were sealed for that very
// row and column, so the audit's swap (H4: a message body copied into a forged row beside a plain attacker address)
// is refused with a code instead of being sent, while a real row from the app opens whole.

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveUserKeys, encryptAt, encryptField, newDataKey, openExpected, type UserKeys } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { openOutboxAddresses, openOutboxText, refusalCode, type BoundOpener } from "./outbox-open";

const USER = "caabe3e9-0000-4000-8000-000000000001";
const ROW = "caabe3e9-0000-4000-8000-0000000000b1";
const keys = await deriveUserKeys(newDataKey(), USER);

/** vault.ts openBound without the database: encryption on, legacy values allowed or not. */
const opener = (k: UserKeys, legacy = false): BoundOpener => (_user, field, value, at) => openExpected(k, field, value, { ...at, sealed: true, legacy });
const sealFor = (column: string, field: string, value: string, row = ROW) => encryptAt(keys, field, { place: `outbox.${column}`, row }, value);

test("a row the app sealed for itself opens whole", async () => {
  const row = {
    id: ROW, user_id: USER,
    body: await sealFor("body", FIELD.body, "Hello"), subject: await sealFor("subject", FIELD.subject, "Plans"),
    from_address: await sealFor("from_address", FIELD.address, "me@example.com"),
    to_addresses: [await sealFor("to_addresses", FIELD.address, "sam@example.com")],
    cc_addresses: [await sealFor("cc_addresses", FIELD.address, "kim@example.com")], bcc_addresses: [],
  };
  const text = await openOutboxText(row, opener(keys));
  assert.equal(text.body, "Hello");
  assert.equal(text.subject, "Plans");
  const people = await openOutboxAddresses(row, opener(keys));
  assert.equal(people.from_address, "me@example.com");
  assert.deepEqual(people.to_addresses, ["sam@example.com"]);
  assert.deepEqual(people.cc_addresses, ["kim@example.com"]);
});

test("the swap attack is refused: a copied message body, a plain address, or another row's values never open", async () => {
  const forged = "caabe3e9-0000-4000-8000-0000000000f1";
  const messageBody = await encryptAt(keys, FIELD.body, { place: "messages.body_text" }, "Confidential");
  await assert.rejects(openOutboxText({ id: forged, user_id: USER, body: messageBody }, opener(keys)), (err) => refusalCode(err) === "sealed_elsewhere");
  await assert.rejects(openOutboxAddresses({ id: forged, user_id: USER, to_addresses: ["attacker@example.com"] }, opener(keys)), (err) => refusalCode(err) === "plaintext_refused");
  // The victim's own earlier outbox values, copied into the forged row, are bound to their own row.
  const body = await sealFor("body", FIELD.body, "Earlier reply");
  const to = await sealFor("to_addresses", FIELD.address, "sam@example.com");
  await assert.rejects(openOutboxText({ id: forged, user_id: USER, body }, opener(keys)), (err) => refusalCode(err) === "sealed_elsewhere");
  await assert.rejects(openOutboxAddresses({ id: forged, user_id: USER, to_addresses: [to] }, opener(keys)), (err) => refusalCode(err) === "sealed_elsewhere");
  // An address moved from To into Cc of the same row does not open there either.
  await assert.rejects(openOutboxAddresses({ id: ROW, user_id: USER, to_addresses: [], cc_addresses: [to] }, opener(keys)), (err) => refusalCode(err) === "sealed_elsewhere");
  // Another user's value never opens.
  const other = await deriveUserKeys(newDataKey(), "caabe3e9-0000-4000-8000-000000000002");
  await assert.rejects(openOutboxText({ id: ROW, user_id: USER, body: await encryptAt(other, FIELD.body, { place: "outbox.body", row: ROW }, "x") }, opener(keys)));
});

test("a legacy e1 value opens while legacy values are allowed, and is refused after", async () => {
  const body = await encryptField(keys, FIELD.body, "Queued before the release");
  assert.equal((await openOutboxText({ id: ROW, user_id: USER, body }, opener(keys, true))).body, "Queued before the release");
  await assert.rejects(openOutboxText({ id: ROW, user_id: USER, body }, opener(keys)), (err) => refusalCode(err) === "legacy_value");
});
