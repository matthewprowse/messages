// Tests for host.ts: the request loop the worker runs. A first session builds and saves the index, a second one opens
// it again from encrypted storage, an upsert shows up in the next search, and a changed key starts over.

import test from "node:test";
import assert from "node:assert/strict";
import { deriveUserKeys, newDataKey, type UserKeys } from "@messages/crypto";
import { docId } from "./engine";
import { createHost } from "./host";
import { parseQuery } from "./query";
import type { InitReply, Request, Reply } from "./protocol";
import { memoryStorage } from "./sealed-store";
import type { Doc, SearchResult } from "./types";

const doc = (ref: string, over: Partial<Doc> = {}): Doc => ({ id: docId("note", ref), k: "note", r: ref, t: "", x: "", at: 1, ...over });
const LIMITS = { note: 10 };

function session(storage = memoryStorage()) {
  const replies = new Map<number, Reply>();
  let next = 0;
  const host = createHost(() => storage, (r) => replies.set(r.id, r));
  async function call<T>(req: Request): Promise<T> {
    const id = ++next;
    host.handle({ id, req });
    for (let i = 0; i < 200 && !replies.has(id); i++) await new Promise((r) => setTimeout(r, 1));
    const reply = replies.get(id);
    assert.ok(reply?.ok, `request ${req.t} failed`);
    return (reply as { value: T }).value;
  }
  return { call, storage };
}

async function open(s: ReturnType<typeof session>, keys: UserKeys, userId = "u1") {
  return s.call<InitReply>({ t: "init", keys, userId });
}
const notes = async (s: ReturnType<typeof session>, text: string) =>
  (await s.call<SearchResult>({ t: "search", q: parseQuery(text), limits: LIMITS })).note.hits.map((h) => h.doc.r);

test("what one session indexes is there, from encrypted storage, in the next", async () => {
  const keys = await deriveUserKeys(newDataKey());
  const first = session();
  assert.equal((await open(first, keys)).counts.docs, 0);
  await first.call({ t: "upsert", docs: [doc("a", { t: "Budget Plan" }), doc("b", { t: "Holiday List" })] });
  await first.call({ t: "meta", data: { done: true } });
  await first.call({ t: "flush" });
  assert.deepEqual(await notes(first, "budget"), ["a"]);

  const second = session(first.storage);
  const reopened = await open(second, keys);
  assert.equal(reopened.rebuilt, false);
  assert.equal(reopened.counts.docs, 2);
  assert.deepEqual(reopened.meta, { done: true });
  assert.deepEqual(await notes(second, "holiday"), ["b"]);
});

test("later changes reach the search at once and the disk after a flush", async () => {
  const keys = await deriveUserKeys(newDataKey());
  const s = session();
  await open(s, keys);
  await s.call({ t: "upsert", docs: [doc("a", { t: "Old Title" })] });
  await s.call({ t: "upsert", docs: [doc("a", { t: "New Title" })] });
  assert.deepEqual(await notes(s, "old"), []);
  assert.deepEqual(await notes(s, "new"), ["a"]);
  await s.call({ t: "remove", ids: [docId("note", "a")] });
  assert.deepEqual(await notes(s, "title"), []);
  await s.call({ t: "flush" });
  assert.equal((await open(session(s.storage), keys)).counts.docs, 0);
});

test("known and stamps report what is held", async () => {
  const keys = await deriveUserKeys(newDataKey());
  const s = session();
  await open(s, keys);
  await s.call({ t: "upsert", docs: [doc("a", { at: 5 })] });
  assert.deepEqual(await s.call({ t: "known", ids: [docId("note", "a"), docId("note", "zz")] }), [docId("note", "a")]);
  assert.deepEqual(await s.call({ t: "stamps", kind: "note" }), [["a", 5]]);
});

test("a key that cannot open the stored index starts the build again", async () => {
  const first = session();
  await open(first, await deriveUserKeys(newDataKey()));
  await first.call({ t: "upsert", docs: [doc("a", { t: "Budget" })] });
  await first.call({ t: "flush" });

  const second = session(first.storage);
  const reopened = await open(second, await deriveUserKeys(newDataKey()));
  assert.equal(reopened.rebuilt, true);
  assert.equal(reopened.counts.docs, 0);
  assert.deepEqual(await notes(second, "budget"), []);
  assert.equal(first.storage.raw.size, 0);
});

test("clear wipes memory and disk, even before the index was opened", async () => {
  const keys = await deriveUserKeys(newDataKey());
  const s = session();
  await open(s, keys);
  await s.call({ t: "upsert", docs: [doc("a", { t: "Budget" })] });
  await s.call({ t: "flush" });
  assert.ok(s.storage.raw.size > 0);
  await s.call({ t: "clear" });
  assert.equal(s.storage.raw.size, 0);
  assert.deepEqual(await notes(s, "budget"), []);

  const fresh = session(s.storage);
  await open(fresh, keys);
  await fresh.call({ t: "upsert", docs: [doc("b")] });
  await fresh.call({ t: "flush" });
  const cold = session(fresh.storage);
  await cold.call({ t: "clear" });
  assert.equal(fresh.storage.raw.size, 0);
});
