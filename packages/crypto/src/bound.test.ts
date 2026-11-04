// Tests for the bound value format (bound.ts, through index.ts): e2, t2 and e2b match bound-vectors.json byte for byte,
// a value opens only for its owner, field, place and row, the outbox swap attack of the security audit (H4) fails, and
// the strict readers refuse plain text, legacy and team values and files whose sealed flag lies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  at, decryptAny, decryptBytes, decryptField, decryptTeamBytes, decryptTeamField, deriveTeamKeys, deriveUserKeyring, deriveUserKeys, encryptAt, encryptBytes, encryptBytesAt,
  encryptField, encryptTeamAt, encryptTeamBytesAt, isCiphertext, isLegacyCiphertext, isSealedBytes, isTeamCiphertext, newDataKey, openExpected, openFileExpected, placeOf,
  SEALED_OVERHEAD_BYTES, type Strict,
} from "./index";

const v = JSON.parse(readFileSync(new URL("../bound-vectors.json", import.meta.url), "utf8"));
const hex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const keys = await deriveUserKeys(hex(v.dataKeyHex), v.userId);
const team = await deriveTeamKeys(hex(v.teamDataKeyHex), v.workspaceId);
const OUTBOX = "caabe3e9-0000-4000-8000-0000000000b1";

test("bound fields and files match the saved vectors byte for byte, and open again", async () => {
  for (const c of v.fields) {
    assert.equal(await encryptAt(keys, c.field, { place: c.place, row: c.row }, c.plaintext, Uint8Array.from(c.nonce)), c.ciphertext);
    assert.equal(await decryptField(keys, c.field, c.ciphertext), c.plaintext);
    assert.deepEqual(placeOf(c.ciphertext), { place: c.place, row: c.row });
  }
  for (const c of v.teamFields) {
    assert.equal(await encryptTeamAt(team, c.field, { place: c.place, row: c.row }, c.plaintext, Uint8Array.from(c.nonce)), c.ciphertext);
    assert.equal(await decryptTeamField(team, c.field, c.ciphertext), c.plaintext);
    assert.ok(isTeamCiphertext(c.ciphertext) && !isLegacyCiphertext(c.ciphertext));
  }
  for (const f of v.files) {
    const plain = hex(f.plainHex);
    const sealed = f.owner === "user" ? await encryptBytesAt(keys, f.field, f.where, plain, Uint8Array.from(f.nonce)) : await encryptTeamBytesAt(team, f.field, f.where, plain, Uint8Array.from(f.nonce));
    assert.equal(Buffer.from(sealed).toString("hex"), f.sealedHex);
    assert.ok(isSealedBytes(sealed));
    assert.equal(sealed.length, plain.length + SEALED_OVERHEAD_BYTES);
    assert.deepEqual(f.owner === "user" ? await decryptBytes(keys, f.field, sealed, f.where) : await decryptTeamBytes(team, f.field, sealed, f.where), plain);
  }
});

test("a bound value opens only for its own user, field, and untouched place and row", async () => {
  const c = v.fields[0];
  await assert.rejects(decryptField(await deriveUserKeys(hex(v.dataKeyHex), "caabe3e9-0000-4000-8000-000000000002"), c.field, c.ciphertext));
  await assert.rejects(decryptField(await deriveUserKeys(hex(v.dataKeyHex)), c.field, c.ciphertext), { code: "no_owner" });
  await assert.rejects(decryptField(keys, "subject", c.ciphertext));
  // Editing the place in the header breaks the tag: the place is authenticated, not just stated.
  const bytes = Buffer.from(c.ciphertext.slice(3), "base64");
  bytes[1] = "i".charCodeAt(0); // "outbox.body" becomes "iutbox.body"
  await assert.rejects(decryptField(keys, c.field, `e2:${bytes.toString("base64")}`));
  // A team's key never opens a user's value, nor the other way round.
  await assert.rejects(decryptAny({ team }, c.field, c.ciphertext));
  await assert.rejects(decryptField(keys, v.teamFields[0].field, v.teamFields[0].ciphertext));
  await assert.rejects(decryptTeamField(await deriveTeamKeys(hex(v.teamDataKeyHex), "caabe3e9-0000-4000-8000-0000000000a2"), v.teamFields[0].field, v.teamFields[0].ciphertext));
});

test("a bound file opens only at its own place and for its own user", async () => {
  const f = v.files[0];
  const sealed = hex(f.sealedHex);
  await assert.rejects(decryptBytes(keys, f.field, sealed, f.where.replace("c1/file", "c2/file")));
  await assert.rejects(decryptBytes(keys, f.field, sealed), { code: "no_place" });
  await assert.rejects(decryptBytes(await deriveUserKeys(hex(v.dataKeyHex), "caabe3e9-0000-4000-8000-000000000002"), f.field, sealed, f.where));
  await assert.rejects(decryptBytes(keys, "attachment_data", sealed, f.where));
});

const strict = (over: Partial<Strict> = {}): Strict => ({ places: ["outbox.body"], row: OUTBOX, sealed: true, legacy: false, ...over });

test("the outbox swap attack fails: a message body copied into an outbox row does not open there", async () => {
  // The victim's confidential message, sealed where ingest put it.
  const messageBody = await encryptAt(keys, "body", at("messages", "body_text"), "Bank details: 123");
  // Someone with database write copies it into an outbox row they made, beside a plain address of their own.
  const forged = { id: "caabe3e9-0000-4000-8000-0000000000f1", body: messageBody, to: "attacker@example.com" };
  await assert.rejects(openExpected(keys, "body", forged.body, strict({ row: forged.id })), { code: "sealed_elsewhere" });
  await assert.rejects(openExpected(keys, "address", forged.to, strict({ places: ["outbox.to_addresses"], row: forged.id })), { code: "plaintext_refused" });
  // A real outbox body copied into another outbox row fails too: it is bound to its own row.
  const real = await encryptAt(keys, "body", at("outbox", "body", OUTBOX), "Hello");
  assert.equal(await openExpected(keys, "body", real, strict()), "Hello");
  await assert.rejects(openExpected(keys, "body", real, strict({ row: forged.id })), { code: "sealed_elsewhere" });
  // The same copy as a legacy e1 value is refused once legacy values are (after the re-seal).
  const legacy = await encryptField(keys, "body", "Bank details: 123");
  await assert.rejects(openExpected(keys, "body", legacy, strict()), { code: "legacy_value" });
  assert.equal(await openExpected(keys, "body", legacy, strict({ legacy: true })), "Bank details: 123");
});

test("strict reads refuse team values and unplaced ones, never answer empty, and allow plain text only with encryption off", async () => {
  const teamBody = await encryptTeamAt(team, "body", at("outbox", "body", OUTBOX), "Hi");
  await assert.rejects(openExpected(keys, "body", teamBody, strict({ legacy: true })), { code: "team_value_refused" });
  const unplaced = await encryptAt(keys, "body", { place: "" }, "Hi");
  await assert.rejects(openExpected(keys, "body", unplaced, strict()), { code: "sealed_elsewhere" });
  const noRow = await encryptAt(keys, "body", at("outbox", "body"), "Hi");
  await assert.rejects(openExpected(keys, "body", noRow, strict()), { code: "sealed_elsewhere" });
  assert.equal(await openExpected(keys, "body", "plain", strict({ sealed: false })), "plain");
  assert.equal(await openExpected(keys, "body", null, strict()), null);
  const altered = Buffer.from((await encryptAt(keys, "body", at("outbox", "body", OUTBOX), "Hi")).slice(3), "base64");
  altered[altered.length - 1] ^= 1;
  await assert.rejects(openExpected(keys, "body", `e2:${altered.toString("base64")}`, strict()));
});

test("strict file reads check the sealed flag against the header and refuse plain or legacy files when they must", async () => {
  const where = "attachments/u/outbox/f/file";
  const bound = await encryptBytesAt(keys, "outbox_file_data", where, Uint8Array.of(1, 2));
  const rule = { sealed: true, legacy: false };
  assert.deepEqual(await openFileExpected(keys, "outbox_file_data", bound, where, rule), Uint8Array.of(1, 2));
  await assert.rejects(openFileExpected(keys, "outbox_file_data", bound, where, { ...rule, flagged: false }), { code: "sealed_mismatch" });
  await assert.rejects(openFileExpected(keys, "outbox_file_data", Uint8Array.of(1, 2), where, { ...rule, flagged: true }), { code: "sealed_mismatch" });
  await assert.rejects(openFileExpected(keys, "outbox_file_data", Uint8Array.of(1, 2), where, rule), { code: "plaintext_refused" });
  assert.deepEqual(await openFileExpected(keys, "outbox_file_data", Uint8Array.of(1, 2), where, { sealed: false, legacy: false }), Uint8Array.of(1, 2));
  const legacy = await encryptBytes(keys, "outbox_file_data", Uint8Array.of(3));
  await assert.rejects(openFileExpected(keys, "outbox_file_data", legacy, where, rule), { code: "legacy_value" });
  assert.deepEqual(await openFileExpected(keys, "outbox_file_data", legacy, where, { ...rule, legacy: true }), Uint8Array.of(3));
  // Another user's file at the same path does not open.
  const other = await encryptBytesAt(await deriveUserKeys(newDataKey(), "caabe3e9-0000-4000-8000-000000000002"), "outbox_file_data", where, Uint8Array.of(1));
  await assert.rejects(openFileExpected(keys, "outbox_file_data", other, where, rule));
});

test("a rotated keyring opens bound values sealed under either key, and seals with the current one", async () => {
  const previous = newDataKey();
  const current = newDataKey();
  const old = await encryptAt(await deriveUserKeys(previous, v.userId), "body", at("outbox", "body", OUTBOX), "Moved");
  const ring = await deriveUserKeyring(current, [previous], null, v.userId);
  assert.equal(await decryptField(ring, "body", old), "Moved");
  const fresh = await encryptAt(ring, "body", at("outbox", "body", OUTBOX), "New");
  assert.equal(await decryptField(await deriveUserKeys(current, v.userId), "body", fresh), "New");
  const oldFile = await encryptBytesAt(await deriveUserKeys(previous, v.userId), "attachment_data", "attachments/x", Uint8Array.of(7));
  assert.deepEqual(await decryptBytes(ring, "attachment_data", oldFile, "attachments/x"), Uint8Array.of(7));
});

test("bound values are recognised as ciphertext, and places are checked when sealing", async () => {
  const e2 = await encryptAt(keys, "name", at("contacts", "display_name"), "Sam");
  assert.ok(isCiphertext(e2) && !isTeamCiphertext(e2) && !isLegacyCiphertext(e2));
  assert.ok(isLegacyCiphertext(await encryptField(keys, "name", "Sam")));
  await assert.rejects(encryptAt(keys, "name", { place: "Contacts.Name" }, "Sam"), { code: "bad_place" });
  await assert.rejects(encryptAt(keys, "name", { place: "contacts.name", row: "a|b" }, "Sam"), { code: "bad_place" });
  await assert.rejects(encryptAt(await deriveUserKeys(newDataKey()), "name", at("contacts", "display_name"), "Sam"), { code: "no_owner" });
  assert.equal(placeOf("e1:abc"), null);
  assert.equal(placeOf("plain"), null);
});
