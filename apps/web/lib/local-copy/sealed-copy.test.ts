// Tests for sealed-copy.ts: the device copy survives a round trip, shows no plaintext on disk, keeps its key
// non-exportable, is deleted with its key on a user or version mismatch or damage, is cleared on sign-out, and is
// trimmed to the size cap.

import test from "node:test";
import assert from "node:assert/strict";
import type { Contact, Profile, Thread } from "../types";
import { type CopyData, memoryCopyStorage, SealedCopy } from "./sealed-copy";

const thread = (id: string, at: string, patch: Partial<Thread> = {}) => ({ id, lastMessageAt: at, status: "inbox", participantIds: [`c-${id}`], summary: "", preview: "", ...patch } as Thread);
const contact = (id: string, patch: Partial<Contact> = {}) => ({ id, name: id, emails: [], phones: [], ...patch } as Contact);
const copyOf = (patch: Partial<CopyData> = {}): CopyData => ({
  threads: [thread("t1", "2026-11-01T10:00:00Z")], contacts: [contact("c-t1")], accounts: [], rules: [], writingExamples: [],
  profile: { name: "Me" } as Profile, unsubscribes: [], tasks: [], ...patch,
});

function setup(opts: { version?: number; maxBytes?: number } = {}) {
  const storage = memoryCopyStorage();
  return { storage, copy: new SealedCopy(storage, crypto.subtle, opts) };
}

async function saved(userId = "u1", data = copyOf()) {
  const s = setup();
  await s.copy.open(userId);
  assert.equal(await s.copy.save(userId, data), true);
  return s;
}

test("a saved copy opens again for the same user, on this device", async () => {
  const data = copyOf({ threads: [thread("t1", "2026-11-01T10:00:00Z", { subject: "Lease renewal" })] });
  const { storage } = await saved("u1", data);
  const reopened = new SealedCopy(storage, crypto.subtle);
  assert.deepEqual(await reopened.open("u1"), data);
});

test("nothing readable is stored, and the device key cannot be exported", async () => {
  const data = copyOf({
    threads: [thread("t1", "2026-11-01T10:00:00Z", { subject: "Confidential Offer", preview: "wire transfer details" })],
    contacts: [contact("c-t1", { name: "Thandi Nkosi", emails: ["thandi@client.co.za"] })],
  });
  const { storage } = await saved("user-8d3f1c42", data);
  const key = storage.raw.get("device-key") as CryptoKey;
  assert.equal(key.extractable, false);
  await assert.rejects(crypto.subtle.exportKey("raw", key));
  const stored = storage.raw.get("copy") as { iv: Uint8Array; data: Uint8Array };
  const text = Buffer.from(stored.data).toString("latin1");
  for (const secret of ["Confidential", "wire transfer", "Thandi", "thandi@client", "user-8d3f1c42"]) assert.ok(!text.includes(secret), `leaks ${secret}`);
});

test("another user's copy is never shown, and it goes with the key", async () => {
  const { storage } = await saved("u1");
  assert.equal(await new SealedCopy(storage, crypto.subtle).open("u2"), null);
  assert.equal(storage.raw.size, 0);
});

test("a copy in another format version is dropped", async () => {
  const { storage } = await saved("u1");
  assert.equal(await new SealedCopy(storage, crypto.subtle, { version: 2 }).open("u1"), null);
  assert.equal(storage.raw.size, 0);
});

test("a damaged copy, a stray record or a missing key is dropped rather than shown", async () => {
  const damaged = await saved("u1");
  const stored = damaged.storage.raw.get("copy") as { data: Uint8Array };
  stored.data[5] ^= 0xff;
  assert.equal(await new SealedCopy(damaged.storage, crypto.subtle).open("u1"), null);
  assert.equal(damaged.storage.raw.size, 0);

  const stray = setup();
  await stray.storage.put("copy", "not a copy");
  assert.equal(await stray.copy.open("u1"), null);
  assert.equal(stray.storage.raw.size, 0);

  const keyless = await saved("u1");
  keyless.storage.raw.delete("device-key");
  assert.equal(await new SealedCopy(keyless.storage, crypto.subtle).open("u1"), null);
  assert.equal(keyless.storage.raw.size, 0);
});

test("a fresh device has no copy and that is not an error", async () => {
  const { copy, storage } = setup();
  assert.equal(await copy.open("u1"), null);
  assert.equal(storage.raw.size, 0);
});

test("sign-out deletes the copy and the key, and nothing is saved again until a copy is opened", async () => {
  const { copy, storage } = await saved("u1");
  await copy.clear();
  assert.equal(storage.raw.size, 0);
  assert.equal(await copy.save("u1", copyOf()), false);
  assert.equal(storage.raw.size, 0);
  await copy.open("u2");
  assert.equal(await copy.save("u1", copyOf()), false, "only the user whose copy was opened saves");
  assert.equal(await copy.save("u2", copyOf()), true);
});

test("a save already under way when sign-out clears never writes", async () => {
  const { copy, storage } = setup();
  await copy.open("u1");
  const saving = copy.save("u1", copyOf());
  await copy.clear();
  assert.equal(await saving, false);
  assert.equal(storage.raw.size, 0);
});

test("signing in as another user replaces the copy and the key", async () => {
  const { storage, copy } = await saved("u1");
  const firstKey = storage.raw.get("device-key");
  assert.equal(await copy.open("u2"), null);
  await copy.save("u2", copyOf({ profile: { name: "Second" } as Profile }));
  assert.notEqual(storage.raw.get("device-key"), firstKey);
  assert.equal((await new SealedCopy(storage, crypto.subtle).open("u2"))?.profile.name, "Second");
});

test("over the size cap the oldest conversations are left out, with the people only they named", async () => {
  const threads = Array.from({ length: 40 }, (_, i) => thread(`t${i}`, `2026-10-${String(i % 28 + 1).padStart(2, "0")}T${String(Math.floor(i / 28)).padStart(2, "0")}:00:00Z`, { summary: "x".repeat(400) }));
  const contacts = threads.map((t) => contact(`c-${t.id}`));
  const { copy, storage } = setup({ maxBytes: 12_000 });
  await copy.open("u1");
  assert.equal(await copy.save("u1", copyOf({ threads, contacts })), true);
  const kept = await new SealedCopy(storage, crypto.subtle).open("u1");
  assert.ok(kept && kept.threads.length > 0 && kept.threads.length < 40);
  const newest = [...threads].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)).slice(0, kept.threads.length);
  assert.deepEqual(kept.threads.map((t) => t.id), newest.map((t) => t.id));
  assert.deepEqual(kept.contacts.map((c) => c.id).sort(), kept.threads.map((t) => `c-${t.id}`).sort());
});

test("a copy too large even with no conversations is not written", async () => {
  const { copy, storage } = setup({ maxBytes: 500 });
  await copy.open("u1");
  assert.equal(await copy.save("u1", copyOf({ rules: [{ id: "r", kind: "always_important", target: "x".repeat(2000) }] })), false);
  assert.equal(storage.raw.has("copy"), false);
});
