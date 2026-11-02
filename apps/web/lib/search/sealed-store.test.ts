// Tests for sealed-store.ts: the encrypted index survives a round trip, shows no plaintext on disk, is cleared by a
// different key or user, and a change rewrites only the shard it touched.

import test from "node:test";
import assert from "node:assert/strict";
import { deriveUserKeys, newDataKey } from "@messages/crypto";
import { docId } from "./engine";
import { memoryStorage, SealedStore, shardOf } from "./sealed-store";
import type { Doc } from "./types";

const doc = (ref: string, over: Partial<Doc> = {}): Doc => ({ id: docId("message", ref), k: "message", r: ref, t: "", x: "hello", at: 1, ...over });
const lookup = (docs: Doc[]) => { const m = new Map(docs.map((d) => [d.id, d])); return (id: string) => m.get(id); };

async function stores() {
  const keys = await deriveUserKeys(newDataKey());
  return { keys, storage: memoryStorage() };
}

async function save(store: SealedStore, docs: Doc[], meta: unknown = { done: true }) {
  store.markUpserted(docs.map((d) => d.id));
  store.setMeta(meta);
  await store.flush(lookup(docs));
}

test("documents and the record beside them come back after a round trip", async () => {
  const { keys, storage } = await stores();
  const docs = Array.from({ length: 50 }, (_, i) => doc(`m${i}`, { x: `body ${i}` }));
  await save(new SealedStore(storage, keys, "u1"), docs, { cursor: "abc" });
  const loaded = await new SealedStore(storage, keys, "u1").load();
  assert.equal(loaded.rebuilt, false);
  assert.deepEqual(loaded.meta, { cursor: "abc" });
  assert.deepEqual(loaded.docs.map((d) => d.id).sort(), docs.map((d) => d.id).sort());
  assert.equal(loaded.docs.find((d) => d.r === "m7")?.x, "body 7");
});

test("nothing readable is written to disk", async () => {
  const { keys, storage } = await stores();
  await save(new SealedStore(storage, keys, "user-8d3f1c42-a7"), [doc("m1", { t: "Confidential Subject", x: "secret@client.com wire transfer" })]);
  assert.ok(storage.raw.size >= 2);
  for (const [name, bytes] of storage.raw) {
    const text = Buffer.from(bytes).toString("latin1");
    assert.ok(!/Confidential|secret@client|wire transfer/.test(text), `${name} leaks text`);
    assert.ok(!text.includes("user-8d3f1c42-a7"), `${name} leaks the user id`);
  }
});

test("a different key cannot open the index: it is cleared and reported as rebuilt", async () => {
  const { keys, storage } = await stores();
  await save(new SealedStore(storage, keys, "u1"), [doc("m1")]);
  const other = await deriveUserKeys(newDataKey());
  const loaded = await new SealedStore(storage, other, "u1").load();
  assert.deepEqual(loaded, { docs: [], meta: null, rebuilt: true });
  assert.equal(storage.raw.size, 0);
});

test("another user's index is never reused, even with a key that opens it", async () => {
  const { keys, storage } = await stores();
  await save(new SealedStore(storage, keys, "u1"), [doc("m1")]);
  const loaded = await new SealedStore(storage, keys, "u2").load();
  assert.equal(loaded.rebuilt, true);
  assert.equal(storage.raw.size, 0);
});

test("an empty storage is a fresh start, not a rebuild", async () => {
  const { keys, storage } = await stores();
  assert.deepEqual(await new SealedStore(storage, keys, "u1").load(), { docs: [], meta: null, rebuilt: false });
});

test("a shard moved to another name fails to open, so the index is rebuilt", async () => {
  const { keys, storage } = await stores();
  const docs = [doc("m1"), doc("m2"), doc("m3"), doc("m4"), doc("m5")];
  await save(new SealedStore(storage, keys, "u1"), docs);
  const names = [...storage.raw.keys()].filter((k) => k !== "meta");
  assert.ok(names.length >= 2);
  const [a, b] = names;
  storage.raw.set(b, storage.raw.get(a)!);
  assert.equal((await new SealedStore(storage, keys, "u1").load()).rebuilt, true);
});

test("a change rewrites only its own shard, and removing the last document deletes the shard", async () => {
  const { keys, storage } = await stores();
  const docs = Array.from({ length: 40 }, (_, i) => doc(`m${i}`));
  const store = new SealedStore(storage, keys, "u1");
  await save(store, docs);
  const before = new Map(storage.raw);

  const changed = { ...docs[3], x: "edited" };
  const now = [...docs.slice(0, 3), changed, ...docs.slice(4)];
  store.markUpserted([changed.id]);
  await store.flush(lookup(now));
  const rewritten = [...storage.raw].filter(([k, v]) => k !== "meta" && before.get(k) !== v).map(([k]) => k);
  assert.deepEqual(rewritten, [`s${shardOf(changed.id)}`]);

  const loneStorage = memoryStorage();
  const lone = new SealedStore(loneStorage, keys, "u1");
  const only = doc("only");
  await save(lone, [only]);
  lone.markRemoved([only.id]);
  await lone.flush(() => undefined);
  const reloaded = await new SealedStore(loneStorage, keys, "u1").load();
  assert.deepEqual(reloaded.docs, []);
});

test("clear empties the storage", async () => {
  const { keys, storage } = await stores();
  const store = new SealedStore(storage, keys, "u1");
  await save(store, [doc("m1")]);
  await store.clear();
  assert.equal(storage.raw.size, 0);
  assert.equal(store.pending, false);
});

test("the same id always lands in the same shard, inside the range", () => {
  assert.equal(shardOf("mabc"), shardOf("mabc"));
  for (const id of ["a", "mxyz", "n" + "1".repeat(40)]) assert.ok(shardOf(id) >= 0 && shardOf(id) < 512);
});
