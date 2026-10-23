import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dataKeyFor, localWrapper, type KeyStore } from "./wrap";

const vectors = JSON.parse(readFileSync(new URL("../vectors.json", import.meta.url), "utf8"));

test("the local wrapper unwraps the saved key, and only for the user it was wrapped for", async () => {
  const w = await localWrapper(vectors.localWrap.masterKeyBase64);
  const key = await w.unwrap(vectors.localWrap.wrapped, vectors.localWrap.userId);
  assert.equal(Buffer.from(key).toString("hex"), vectors.dataKeyHex);
  await assert.rejects(w.unwrap(vectors.localWrap.wrapped, "someone-else"));
});

test("dataKeyFor creates a key once and returns the same one after", async () => {
  const rows = new Map<string, { wrapped_key: string; wrapped_by: string }>();
  const store: KeyStore = {
    read: async (id) => rows.get(id) ?? null,
    insertIfAbsent: async (r) => { if (!rows.has(r.user_id)) rows.set(r.user_id, r); },
  };
  const w = await localWrapper(vectors.localWrap.masterKeyBase64);
  const a = await dataKeyFor(store, [w], "u1");
  const b = await dataKeyFor(store, [w], "u1");
  assert.deepEqual(a, b);
  assert.equal(rows.size, 1);
  assert.equal(a.length, 32);
});
