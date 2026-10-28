import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptTeamField } from "@messages/crypto";
import { teamAddressIndex, teamDomainIndex } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import { fillClients, MAX_GROUP_CLIENTS } from "./clients";
import { AGENT, COLLEAGUE, contact, FakeClients, WS, world } from "./fixtures";
import type { ThreadRow } from "./reseal";

// Filling the team's client list when a chat is shared, over real keys and an in-memory list that keeps the rules of
// upsert_workspace_contact. Synthetic people only.

const T = "thread-1";
const thread = (over: Partial<ThreadRow> = {}) => ({ id: T, user_id: AGENT, workspace_id: WS, is_group: false, ...over });

test("every person in the chat joins the list, sealed and indexed with the team key", async () => {
  const w = await world();
  const store = new FakeClients();
  store.people.set(T, [await contact(w, "Thandi Mokoena", [["email", "Thandi@Acme.co.za"], ["phone", "+27821112222"], ["whatsapp", "+27821112222"]], { name: "Acme Properties", domain: "acme.co.za" })]);
  const out = await fillClients(thread(), store, w.keys);
  assert.deepEqual(out, { added: 1, skipped: 0, failed: 0 });
  const [c] = store.clients;
  assert.equal(await decryptTeamField(w.team, FIELD.name, c.name), "Thandi Mokoena");
  assert.equal(await decryptTeamField(w.team, FIELD.name, c.companyName!), "Acme Properties");
  assert.equal(c.companyDomainIndex, await teamDomainIndex(w.team, "acme.co.za"));
  // the phone and the whatsapp number are one identity, the email another
  assert.deepEqual([...c.identities.keys()].sort(), [await teamAddressIndex(w.team, "thandi@acme.co.za"), await teamAddressIndex(w.team, "+27821112222")].sort());
  for (const i of c.identities.values()) assert.ok(i.value.startsWith("t1:"), "values are sealed with the team key");
  assert.ok(c.agents.has(AGENT));
  assert.equal(store.companies.size, 1);
  // nothing readable reaches the database
  assert.ok(!JSON.stringify(store.calls).includes("Thandi"));
  assert.ok(!JSON.stringify(store.calls).includes("acme.co.za"));
});

test("a chat in a shared inbox adds nobody to the client list", async () => {
  const w = await world();
  const store = new FakeClients();
  store.people.set(T, [await contact(w, "Thandi Mokoena", [["email", "thandi@acme.co.za"]])]);
  assert.deepEqual(await fillClients(thread({ shared_by: "account" }), store, w.keys), { added: 0, skipped: 0, failed: 0 });
  assert.equal(store.clients.length, 0);
  assert.equal((await fillClients(thread({ shared_by: "agent" }), store, w.keys)).added, 1, "the same chat shared by its agent does");
});

test("a company is named from its domain when the contact has no organisation", async () => {
  const w = await world();
  const store = new FakeClients();
  store.people.set(T, [await contact(w, "Pieter Botha", [["email", "pieter@big-talent.co.za"]])]);
  await fillClients(thread(), store, w.keys);
  assert.equal(await decryptTeamField(w.team, FIELD.name, store.clients[0].companyName!), "Big Talent");
});

test("the agent's own addresses and a colleague's are skipped, and so are their domains", async () => {
  const w = await world();
  const store = new FakeClients();
  store.own.add("sipho@firm.co.za"); // a colleague on the team's own domain
  store.people.set(T, [
    await contact(w, "Me Myself", [["email", "agent@mine.test"]]),
    await contact(w, "My Other Number", [["whatsapp", "+27820000000"]]),
    await contact(w, "Sipho Dlamini", [["email", "Sipho@Firm.co.za"]]),
    await contact(w, "Nomsa Zulu", [["email", "nomsa@firm.co.za"]]), // not a colleague, but on the team's own domain
  ]);
  const out = await fillClients(thread(), store, w.keys);
  assert.equal(out.skipped, 3);
  assert.equal(out.added, 1);
  assert.equal(store.clients.length, 1);
  assert.equal(store.clients[0].companyDomainIndex, null, "the team's own domain is not a client company");
  assert.equal(store.companies.size, 0);
});

test("placeholder names and role addresses are skipped", async () => {
  const w = await world();
  const store = new FakeClients();
  store.people.set(T, [
    await contact(w, "+27 82 111 2222", [["phone", "+27821112222"]]),
    await contact(w, "123456789@lid", [["whatsapp", "123456789@lid"]]),
    await contact(w, "thandi@acme.co.za", [["email", "thandi@acme.co.za"]]),
    await contact(w, "No Reply", [["email", "someone@acme.co.za"]]),
    await contact(w, null, [["email", "x@acme.co.za"]]),
    await contact(w, "Acme Notifications", [["email", "noreply@acme.co.za"]]), // only a role address: nothing to know them by
    await contact(w, "Lerato Khumalo", [["email", "lerato@acme.co.za"], ["email", "info@acme.co.za"]]),
  ]);
  const out = await fillClients(thread(), store, w.keys);
  assert.equal(out.added, 1);
  assert.equal(out.skipped, 6);
  // the role address is not an identity of the client, so it can never match unrelated senders
  assert.deepEqual([...store.clients[0].identities.keys()], [await teamAddressIndex(w.team, "lerato@acme.co.za")]);
});

test("a personal mail domain gives a client but no company", async () => {
  const w = await world();
  const store = new FakeClients();
  store.people.set(T, [await contact(w, "Zanele Ndlovu", [["email", "zanele@gmail.com"]], { name: "Gmail", domain: "gmail.com" })]);
  const out = await fillClients(thread(), store, w.keys);
  assert.equal(out.added, 1);
  assert.equal(store.clients[0].companyName, null);
  assert.equal(store.clients[0].companyDomainIndex, null);
  assert.equal(store.companies.size, 0);
});

test("it is idempotent: the same chat again, and another agent's chat with the same person, change nothing", async () => {
  const w = await world();
  const store = new FakeClients();
  const people = async () => [await contact(w, "Thandi Mokoena", [["email", "thandi@acme.co.za"]]), await contact(w, "Pieter Botha", [["email", "pieter@acme.co.za"]])];
  store.people.set(T, await people());
  await fillClients(thread(), store, w.keys);
  const snapshot = () => JSON.stringify(store.clients.map((c) => [c.id, c.name, [...c.identities.keys()], [...c.agents]]));
  const before = snapshot();
  await fillClients(thread(), store, w.keys); // a follow-up job for the same chat
  assert.equal(snapshot(), before);
  assert.equal(store.clients.length, 2);

  // a colleague shares their own chat with Thandi, who is a different contact for them but has the same address and a number
  store.people.set("thread-2", [await contact(w, "Thandi M", [["email", "THANDI@acme.co.za"], ["phone", "+27821110000"]], undefined, w.other)]);
  await fillClients(thread({ id: "thread-2", user_id: COLLEAGUE }), store, w.keys);
  assert.equal(store.clients.length, 2, "the same person is one client");
  assert.deepEqual([...store.clients[0].agents].sort(), [AGENT, COLLEAGUE]);
  assert.equal(store.clients[0].identities.size, 2, "the new number was added");
  assert.equal(await decryptTeamField(w.team, FIELD.name, store.clients[0].name), "Thandi Mokoena", "the first name stays");
});

test("a company is filled in later, and only once", async () => {
  const w = await world();
  const store = new FakeClients();
  store.people.set(T, [await contact(w, "Zanele Ndlovu", [["phone", "+27821112222"]])]);
  await fillClients(thread(), store, w.keys);
  assert.equal(store.clients[0].companyName, null);
  store.people.set(T, [await contact(w, "Zanele Ndlovu", [["phone", "+27821112222"], ["email", "zanele@zed.co.za"]])]);
  await fillClients(thread(), store, w.keys);
  assert.equal(await decryptTeamField(w.team, FIELD.name, store.clients[0].companyName!), "Zed");
  assert.equal(store.clients.length, 1);
});

test("a small group adds its people, a crowded one adds no one", async () => {
  const w = await world();
  const store = new FakeClients();
  store.people.set(T, [await contact(w, "Lerato Khumalo", [["whatsapp", "+27821110001"]]), await contact(w, "Pieter Botha", [["whatsapp", "+27821110002"]])]);
  assert.equal((await fillClients(thread({ is_group: true }), store, w.keys)).added, 2);

  const crowd = new FakeClients();
  crowd.people.set(T, await Promise.all(Array.from({ length: MAX_GROUP_CLIENTS + 1 }, (_, i) => contact(w, `Person ${i}`, [["whatsapp", `+2782111${String(i).padStart(4, "0")}`]]))));
  const out = await fillClients(thread({ is_group: true }), crowd, w.keys);
  assert.equal(out.added, 0);
  assert.equal(crowd.clients.length, 0);
  // the same people one to one are not limited by the group rule
  assert.equal((await fillClients(thread({ is_group: false }), crowd, w.keys)).added, MAX_GROUP_CLIENTS + 1);
});

test("a chat that is not shared adds no one, and neither does an agent who has left", async () => {
  const w = await world();
  const store = new FakeClients();
  store.people.set(T, [await contact(w, "Thandi Mokoena", [["email", "thandi@acme.co.za"]])]);
  assert.deepEqual(await fillClients(thread({ workspace_id: null }), store, w.keys), { added: 0, skipped: 0, failed: 0 });
  assert.equal(store.calls.length, 0);
  store.members.delete(AGENT);
  const out = await fillClients(thread(), store, w.keys);
  assert.equal(out.added, 0);
  assert.equal(store.clients.length, 0);
});

test("a value that cannot be opened is counted and the rest still join", async () => {
  const w = await world();
  const store = new FakeClients();
  store.people.set(T, [
    await contact(w, "Sealed Elsewhere", [["email", "x@acme.co.za"]], undefined, w.other), // not this agent's key
    await contact(w, "Thandi Mokoena", [["email", "thandi@acme.co.za"]]),
  ]);
  const out = await fillClients(thread(), store, w.keys);
  assert.deepEqual(out, { added: 1, skipped: 0, failed: 1 });
});

test("readable values from before encryption work too", async () => {
  const w = await world();
  const store = new FakeClients();
  store.people.set(T, [{ name: "Thandi Mokoena", identities: [{ kind: "email", value: "thandi@acme.co.za" }], organization: { name: "Acme", domain: "acme.co.za" } }]);
  assert.equal((await fillClients(thread(), store, w.keys)).added, 1);
  assert.equal(await decryptTeamField(w.team, FIELD.name, store.clients[0].companyName!), "Acme");
});
