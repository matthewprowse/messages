import assert from "node:assert/strict";
import { test } from "node:test";
import { teamAddressIndex } from "@messages/crypto/addresses";
import { fillClients } from "./clients";
import { AGENT, contact, FakeClients, WS, world } from "./fixtures";
import type { ThreadRow } from "./reseal";

// Linking a shared chat to the clients in it (public.link_thread_clients), which is how a compliance export finds a client's
// chats. Synthetic people only.

const T = "thread-1";
const thread = (over: Partial<ThreadRow> = {}) => ({ id: T, user_id: AGENT, workspace_id: WS, is_group: false, ...over });

test("a shared chat is linked by the team index of every person in it", async () => {
  const w = await world();
  const store = new FakeClients();
  store.people.set(T, [await contact(w, "Thandi Mokoena", [["email", "Thandi@Acme.co.za"], ["phone", "+27821112222"]])]);
  await fillClients(thread(), store, w.keys);
  assert.equal(store.links.length, 1);
  assert.equal(store.links[0].workspaceId, WS);
  assert.equal(store.links[0].threadId, T);
  assert.deepEqual(store.links[0].indexes.sort(), [await teamAddressIndex(w.team, "thandi@acme.co.za"), await teamAddressIndex(w.team, "+27821112222")].sort());
  // only indexes go to the database, never an address or a name
  assert.ok(!JSON.stringify(store.links).includes("acme.co.za"));
  assert.ok(!JSON.stringify(store.links).includes("Thandi"));
});

test("a chat in a shared inbox adds nobody to the list but is linked to the clients it has", async () => {
  const w = await world();
  const store = new FakeClients();
  store.people.set(T, [await contact(w, "Thandi Mokoena", [["email", "thandi@acme.co.za"]])]);
  const out = await fillClients(thread({ shared_by: "account" }), store, w.keys);
  assert.deepEqual(out, { added: 0, skipped: 0, failed: 0 });
  assert.equal(store.clients.length, 0, "no client is made from who wrote to an inbox");
  assert.equal(store.calls.length, 0);
  assert.deepEqual(store.links.map((l) => l.indexes), [[await teamAddressIndex(w.team, "thandi@acme.co.za")]]);
});

test("the team's own people and placeholders are never linked", async () => {
  const w = await world();
  const store = new FakeClients();
  store.people.set(T, [
    await contact(w, "Me Myself", [["email", "agent@mine.test"]]),
    await contact(w, "No Reply", [["email", "someone@acme.co.za"]]),
    await contact(w, "Nomsa Zulu", [["email", "nomsa@acme.co.za"]]),
  ]);
  await fillClients(thread(), store, w.keys);
  assert.deepEqual(store.links.map((l) => l.indexes), [[await teamAddressIndex(w.team, "nomsa@acme.co.za")]]);
});

test("a crowded group is not linked, and a chat with nobody in it links nothing", async () => {
  const w = await world();
  const store = new FakeClients();
  store.people.set(T, await Promise.all(Array.from({ length: 12 }, (_, i) => contact(w, `Person Number${i}`, [["email", `p${i}@acme.co.za`]]))));
  await fillClients(thread({ is_group: true }), store, w.keys);
  await fillClients(thread({ id: "empty" }), store, w.keys);
  await fillClients(thread({ is_group: true, shared_by: "account" }), store, w.keys);
  assert.equal(store.links.length, 0);
});

test("a store without link still fills the list, and a failing link is the caller's to log", async () => {
  const w = await world();
  const bare = new FakeClients();
  (bare as { link?: unknown }).link = undefined;
  bare.people.set(T, [await contact(w, "Thandi Mokoena", [["email", "thandi@acme.co.za"]])]);
  assert.equal((await fillClients(thread(), bare, w.keys)).added, 1);

  const broken = new FakeClients();
  broken.people.set(T, [await contact(w, "Thandi Mokoena", [["email", "thandi@acme.co.za"]])]);
  broken.link = async () => { throw new Error("down"); };
  await assert.rejects(fillClients(thread(), broken, w.keys), /down/);
  assert.equal(broken.clients.length, 1, "the client was added before the link failed");
});
