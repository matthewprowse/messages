// rekey/reseal.ts: values under the old key are sealed again under the new one with the same field and context, values
// already current and plain text are left alone, nested JSON and arrays are walked, and what nothing opens is counted.

import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptBytes, decryptField, deriveUserKeyring, encryptAt, encryptBytes, encryptBytesAt, encryptField, openExpected, placeOf } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { deriveCredentialKey, openBound, openCredential, sealBound, sealCredential } from "@messages/crypto/wrap";
import { contextsFor, FieldMemo, resealBytes, resealRow, type KeyPair, type RekeyRing } from "./reseal";

async function pair(n: number): Promise<KeyPair> {
  const raw = Uint8Array.from({ length: 32 }, () => n);
  return { keys: await deriveUserKeyring(raw), credential: await deriveCredentialKey(raw) };
}

const [current, old, stranger] = await Promise.all([pair(1), pair(2), pair(3)]);
const ring: RekeyRing = { current, olds: [old] };

test("a message's text under the old key moves to the new one, field by field, and current text stays", async () => {
  const keyed = { id: "m1" };
  const row = {
    subject: await encryptField(old.keys, FIELD.subject, "Plans"),
    body_text: await encryptField(old.keys, FIELD.body, "The plans are attached."),
    preview: await encryptField(current.keys, FIELD.preview, "The plans"),
    body_html: null,
    label: "plain text stays",
  };
  const { write, tally } = await resealRow(ring, new FieldMemo(), "messages", keyed, row);
  assert.deepEqual(tally, { moved: 2, current: 1, unreadable: 0 });
  assert.deepEqual(Object.keys(write!.set).sort(), ["body_text", "subject"]);
  assert.equal(write!.expect.subject, row.subject);
  assert.equal(await decryptField(current.keys, FIELD.subject, write!.set.subject as string), "Plans");
  assert.equal(await decryptField(current.keys, FIELD.body, write!.set.body_text as string), "The plans are attached.");
  await assert.rejects(decryptField(current.keys, FIELD.body, write!.set.subject as string), "the field is kept");
});

test("addresses inside arrays and JSON are found and moved, and the rest of the JSON is kept", async () => {
  const meta = { quoted: { text: await encryptField(old.keys, FIELD.quote, "earlier"), author: "Sam" }, chat: await encryptField(old.keys, FIELD.address, "27824160503@s.whatsapp.net"), n: 3 };
  const to = [await encryptField(old.keys, FIELD.address, "a@b.com"), await encryptField(current.keys, FIELD.address, "c@d.com")];
  const { write } = await resealRow(ring, new FieldMemo(), "messages", { id: "m2" }, { provider_meta: meta, to_addresses: to });
  const newMeta = write!.set.provider_meta as typeof meta;
  assert.equal(newMeta.quoted.author, "Sam");
  assert.equal(newMeta.n, 3);
  assert.equal(await decryptField(current.keys, FIELD.quote, newMeta.quoted.text), "earlier");
  assert.equal(await decryptField(current.keys, FIELD.address, newMeta.chat), "27824160503@s.whatsapp.net");
  const newTo = write!.set.to_addresses as string[];
  assert.equal(await decryptField(current.keys, FIELD.address, newTo[0]), "a@b.com");
  assert.equal(newTo[1], to[1], "an address already current is the same string");
});

test("a row with nothing under the old key needs no write, and a stranger's value is counted unreadable", async () => {
  const row = { title: await encryptField(current.keys, FIELD.noteTitle, "Ideas"), body: await encryptField(stranger.keys, FIELD.note, "?") };
  const { write, tally } = await resealRow(ring, new FieldMemo(), "notes", { id: "n1" }, row);
  assert.equal(write, null);
  assert.deepEqual(tally, { moved: 0, current: 1, unreadable: 1 });
});

test("sign-ins and handoffs move with the context their table binds them to", async () => {
  const account = "acc-1";
  const sealedCred = await sealCredential(old.credential, account, '{"password":"pw"}');
  const { write } = await resealRow(ring, new FieldMemo(), "account_credentials", { account_id: account }, { ciphertext: sealedCred, refreshed: null });
  assert.equal(await openCredential(current.credential, account, write!.set.ciphertext as string), '{"password":"pw"}');
  const setup = "5e7a0c1d-0000-4000-8000-0000000000d2";
  assert.deepEqual(contextsFor("icloud_setups", "sign_in", { id: setup }, {}), [`handoff:icloud_setups.sign_in:${setup}`]);
  assert.deepEqual(contextsFor("instagram_sign_ins", "code", { account_id: account }, {}), [`handoff:instagram_sign_ins.code:${account}`]);
  assert.deepEqual(contextsFor("whatsapp_auth_keys", "ciphertext", { account_id: account, key_type: "creds", key_id: "" }, {}), [`account:${account}`]);
  const code = await sealBound(old.credential, `handoff:icloud_setups.code:${setup}`, '"123456"');
  const moved = await resealRow(ring, new FieldMemo(), "icloud_setups", { id: setup }, { code });
  assert.equal(await openBound(current.credential, `handoff:icloud_setups.code:${setup}`, moved.write!.set.code as string), '"123456"');
});

test("a sealed file in a column as base64, and a stored file, move to the new key", async () => {
  const vector = await encryptBytes(old.keys, FIELD.embeddingData, Uint8Array.of(9, 8, 7));
  const b64 = Buffer.from(vector).toString("base64");
  const { write } = await resealRow(ring, new FieldMemo(), "message_embeddings", { message_id: "m1" }, { embedding_data: b64 });
  const back = Uint8Array.from(Buffer.from(write!.set.embedding_data as string, "base64"));
  assert.deepEqual(await decryptBytes(current.keys, FIELD.embeddingData, back), Uint8Array.of(9, 8, 7));

  const file = await encryptBytes(old.keys, FIELD.attachmentData, Uint8Array.of(1, 2, 3));
  const out = await resealBytes(ring, [FIELD.noteFileData, FIELD.attachmentData], file);
  assert.equal(out.state, "moved");
  assert.equal(out.field, FIELD.attachmentData);
  assert.deepEqual(await decryptBytes(current.keys, FIELD.attachmentData, out.bytes), Uint8Array.of(1, 2, 3));
  assert.equal((await resealBytes(ring, [FIELD.attachmentData], Uint8Array.of(1, 2, 3))).state, "current", "an unsealed file is left as it is");
});

test("the memo puts the field that last opened a value at a place first", () => {
  const memo = new FieldMemo();
  assert.notEqual(memo.order("messages.body_text")[0], FIELD.body);
  memo.note("messages.body_text", FIELD.body);
  assert.equal(memo.order("messages.body_text")[0], FIELD.body);
  assert.equal(new Set(memo.order("messages.body_text")).size, memo.order("messages.body_text").length);
});

const USER = "caabe3e9-0000-4000-8000-000000000001";
async function ownedPair(n: number): Promise<KeyPair> {
  const raw = Uint8Array.from({ length: 32 }, () => n);
  return { keys: await deriveUserKeyring(raw, [], null, USER), credential: await deriveCredentialKey(raw) };
}

test("with bind on, a legacy value under either key is sealed again bound to its table, column and row", async () => {
  const [now, before] = await Promise.all([ownedPair(1), ownedPair(2)]);
  const bound: RekeyRing = { current: now, olds: [before] };
  const outboxId = "caabe3e9-0000-4000-8000-0000000000b1";
  const row = { body: await encryptField(now.keys, FIELD.body, "Hello"), subject: await encryptField(before.keys, FIELD.subject, "Plans"), to_addresses: [await encryptField(now.keys, FIELD.address, "sam@example.com")] };
  const { write, tally } = await resealRow(bound, new FieldMemo(), "outbox", { id: outboxId }, row, { bind: true });
  assert.deepEqual(tally, { moved: 3, current: 0, unreadable: 0 });
  const strict = (column: string, field: string, value: string) => openExpected(now.keys, field, value, { places: [`outbox.${column}`], row: outboxId, sealed: true, legacy: false });
  assert.equal(await strict("body", FIELD.body, write!.set.body as string), "Hello");
  assert.equal(await strict("subject", FIELD.subject, write!.set.subject as string), "Plans");
  assert.equal(await strict("to_addresses", FIELD.address, (write!.set.to_addresses as string[])[0]), "sam@example.com");
  // Run again: nothing left to bind, so a pass is clean once every value is bound.
  const again = await resealRow(bound, new FieldMemo(), "outbox", { id: outboxId }, write!.set, { bind: true });
  assert.equal(again.write, null);
  assert.deepEqual(again.tally, { moved: 0, current: 3, unreadable: 0 });
  // Without bind a legacy value under the current key stays as it is.
  assert.equal((await resealRow(bound, new FieldMemo(), "outbox", { id: outboxId }, { body: row.body })).write, null);
});

test("a content table binds the place only, and an outbox file's name binds its outbox row and path from the row's ids", async () => {
  const now = await ownedPair(1);
  const one: RekeyRing = { current: now, olds: [] };
  const msg = await resealRow(one, new FieldMemo(), "messages", { id: "m1" }, { subject: await encryptField(now.keys, FIELD.subject, "Plans") }, { bind: true });
  assert.deepEqual(placeOf(msg.write!.set.subject as string), { place: "messages.subject", row: "" });
  const path = `${USER}/outbox/caabe3e9-0000-4000-8000-0000000000c1/file`;
  const file = await resealRow(one, new FieldMemo(), "outbox_attachments", { id: "a1" }, { filename: await encryptField(now.keys, FIELD.filename, "Plan.pdf"), storage_path: path }, { bind: true, ids: { outbox_id: "o1" } });
  assert.deepEqual(placeOf(file.write!.set.filename as string), { place: "outbox_attachments.filename", row: `o1:${path}` });
});

test("a bound value under the old key keeps its place and row, and a stored file is bound to its path", async () => {
  const [now, before] = await Promise.all([ownedPair(1), ownedPair(2)]);
  const bound: RekeyRing = { current: now, olds: [before] };
  const value = await encryptAt(before.keys, FIELD.body, { place: "outbox.body", row: "o9" }, "Kept");
  const { write } = await resealRow(bound, new FieldMemo(), "outbox", { id: "o1" }, { body: value }, { bind: true });
  assert.deepEqual(placeOf(write!.set.body as string), { place: "outbox.body", row: "o9" }, "the place it was sealed for, not the row it sits in");
  const where = `attachments/${USER}/m1/a1`;
  const legacy = await encryptBytes(now.keys, FIELD.attachmentData, Uint8Array.of(1, 2));
  const moved = await resealBytes(bound, [FIELD.attachmentData], legacy, where, true);
  assert.equal(moved.state, "moved");
  assert.deepEqual(await decryptBytes(now.keys, FIELD.attachmentData, moved.bytes, where), Uint8Array.of(1, 2));
  await assert.rejects(decryptBytes(now.keys, FIELD.attachmentData, moved.bytes, `${where}x`));
  assert.equal((await resealBytes(bound, [FIELD.attachmentData], moved.bytes, where, true)).state, "current");
  const old = await encryptBytesAt(before.keys, FIELD.attachmentData, where, Uint8Array.of(3));
  const rekeyed = await resealBytes(bound, [FIELD.attachmentData], old, where, false);
  assert.equal(rekeyed.state, "moved");
  assert.deepEqual(await decryptBytes(now.keys, FIELD.attachmentData, rekeyed.bytes, where), Uint8Array.of(3));
});
