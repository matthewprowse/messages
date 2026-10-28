import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptTeamField, deriveTeamKeys, encryptField, encryptTeamField, deriveUserKeys, type TeamKeys } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
process.env.SUPABASE_URL ??= "http://localhost";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
const { RETIRE_AFTER_MS, resealValue, resealWorkspace, rotateWorkspace } = await import("./rotate");
import type { Ring, RotateStore, Table } from "./rotate";

const k1 = await deriveTeamKeys(Uint8Array.from(randomBytes(32)));
const k2 = await deriveTeamKeys(Uint8Array.from(randomBytes(32)));
const user = await deriveUserKeys(Uint8Array.from(randomBytes(32)));
const ring: Ring = { version: 2, current: k2, olds: [k1] };

const seal = (keys: TeamKeys, field: string, text: string) => encryptTeamField(keys, field, text);
const opens = async (keys: TeamKeys, field: string, value: string) => decryptTeamField(keys, field, value).then(() => true, () => false);

test("a value under an older version is sealed again with the current one, and the rest is left alone", async () => {
  const old = await seal(k1, FIELD.subject, "Quarterly numbers");
  const fresh = await resealValue(ring, FIELD.subject, old);
  assert.notEqual(fresh, old);
  assert.equal(await decryptTeamField(k2, FIELD.subject, fresh!), "Quarterly numbers");
  assert.equal(await opens(k1, FIELD.subject, fresh!), false); // the old key reads nothing new
  const current = await seal(k2, FIELD.subject, "Already current");
  assert.equal(await resealValue(ring, FIELD.subject, current), current);
  const mine = await encryptField(user, FIELD.subject, "Personal");
  assert.equal(await resealValue(ring, FIELD.subject, mine), mine);
  for (const v of [null, "", "plain text"]) assert.equal(await resealValue(ring, FIELD.subject, v), v);
  await assert.rejects(resealValue(ring, FIELD.body, old), /unreadable/); // another field fails every version
  await assert.rejects(resealValue({ ...ring, olds: [] }, FIELD.subject, old));
});

// A fake workspace: tables of rows, a share_write that checks the old values like the real one.
function fakeStore(rows: Record<Table, Record<string, unknown>[]>) {
  const retired: { workspaceId: string; below: number }[] = [];
  const store: RotateStore = {
    due: async () => [{ workspaceId: "w1", version: 2 }],
    page: async (table, _ws, after, limit) => {
      const key = table === "message_ai" ? "message_id" : table === "workspace_contact_identities" ? "value_index" : table === "workspace_companies" ? "domain_index" : "id";
      return rows[table].filter((r) => after == null || String(r[key]) > after).sort((a, b) => String(a[key]).localeCompare(String(b[key]))).slice(0, limit);
    },
    writeShared: async (table, _thread, _ws, writes) => {
      let n = 0;
      for (const w of writes) {
        const key = table === "message_ai" ? "message_id" : "id";
        const row = rows[table].find((r) => r[key] === w.id);
        if (!row || Object.entries(w.expect).some(([c, was]) => JSON.stringify(row[c] ?? null) !== JSON.stringify(was))) continue;
        Object.assign(row, w.set);
        n++;
      }
      return n;
    },
    writeClient: async (table, _ws, key, w) => {
      const keyColumn = table === "workspace_contacts" ? "id" : table === "workspace_contact_identities" ? "value_index" : "domain_index";
      const row = rows[table].find((r) => r[keyColumn] === key);
      if (!row || Object.entries(w.expect).some(([c, was]) => row[c] !== was)) return false;
      Object.assign(row, w.set);
      return true;
    },
    retire: async (workspaceId, below) => { retired.push({ workspaceId, below }); },
  };
  return { store, retired };
}

const empty = (): Record<Table, Record<string, unknown>[]> => ({ threads: [], messages: [], message_ai: [], attachments: [], workspace_contacts: [], workspace_contact_identities: [], workspace_companies: [] });

async function sample() {
  const rows = empty();
  rows.threads.push({ id: "t1", subject: await seal(k1, FIELD.subject, "Acme renewal"), last_message_preview: await seal(k2, FIELD.preview, "Already current"), summary: null, share_label: await seal(k1, FIELD.name, "Acme"), share_match: null });
  rows.messages.push({
    id: "m1", thread_id: "t1", subject: await seal(k1, FIELD.subject, "Acme renewal"), preview: null, body_text: await seal(k1, FIELD.body, "The contract"), body_html: null, list_unsubscribe: null,
    body_marks: null, transcript: null, sender_address: await seal(k1, FIELD.address, "sam@acme.com"), to_addresses: [await seal(k1, FIELD.address, "me@x.com"), "plain@x.com"],
    provider_meta: { quoted: { text: await seal(k1, FIELD.quote, "earlier") }, chat: "e1:untouched" },
  });
  rows.message_ai.push({ message_id: "m1", thread_id: "t1", summary: await seal(k1, FIELD.summary, "Renewal talk"), reply_choices: null });
  rows.workspace_contacts.push({ id: "c1", name: await seal(k1, FIELD.name, "Sam"), company_name: await seal(k1, FIELD.name, "Acme") });
  rows.workspace_contact_identities.push({ value_index: "idx1", value: await seal(k1, FIELD.address, "sam@acme.com") });
  rows.workspace_companies.push({ domain_index: "dom1", name: await seal(k1, FIELD.name, "Acme") });
  return rows;
}

test("every team value of a workspace ends up under the current key and nothing opens with the old one", async () => {
  const rows = await sample();
  const { store } = fakeStore(rows);
  const outcome = await resealWorkspace("w1", store, ring);
  assert.equal(outcome.state, "done");
  const every = (value: unknown): string[] => (typeof value === "string" && value.startsWith("t1:") ? [value] : Array.isArray(value) ? value.flatMap(every) : value && typeof value === "object" ? Object.values(value).flatMap(every) : []);
  const values = Object.values(rows).flatMap((table) => table.flatMap((r) => Object.values(r).flatMap(every)));
  assert.ok(values.length >= 12);
  for (const v of values) {
    let readable = 0;
    for (const f of [FIELD.subject, FIELD.preview, FIELD.body, FIELD.address, FIELD.quote, FIELD.summary, FIELD.name]) {
      assert.equal(await opens(k1, f, v), false, "the old key opens nothing");
      if (await opens(k2, f, v)) readable++;
    }
    assert.equal(readable, 1, "the current key opens it");
  }
  // Untouched: a user's own value, plain text, and ids inside provider_meta.
  assert.deepEqual((rows.messages[0].to_addresses as string[])[1], "plain@x.com");
  assert.equal((rows.messages[0].provider_meta as { chat: string }).chat, "e1:untouched");
  // Run again: nothing left to do.
  const again = await resealWorkspace("w1", store, ring);
  assert.deepEqual(again, { state: "done", moved: 0 });
});

test("a value nothing opens is counted, left as it was, and stops the old versions being retired", async () => {
  const rows = await sample();
  rows.messages.push({ ...rows.messages[0], id: "m2", body_text: await seal(await deriveTeamKeys(Uint8Array.from(randomBytes(32))), FIELD.body, "from nowhere") });
  const bad = rows.messages[1].body_text;
  const { store, retired } = fakeStore(rows);
  const seen = new Map<string, number>();
  let t = 0;
  const outcome = await rotateWorkspace({ workspaceId: "w1", version: 2 }, store, async () => ring, seen, () => t);
  t += RETIRE_AFTER_MS + 1;
  const later = await rotateWorkspace({ workspaceId: "w1", version: 2 }, store, async () => ring, seen, () => t);
  assert.equal(outcome.state, "incomplete");
  assert.equal(later.state, "incomplete");
  assert.equal(rows.messages[1].body_text, bad);
  assert.deepEqual(retired, []);
});

test("old versions are retired only after a clean pass and the wait for the workers' caches", async () => {
  const rows = await sample();
  const { store, retired } = fakeStore(rows);
  const seen = new Map<string, number>();
  let t = 1_000;
  const first = await rotateWorkspace({ workspaceId: "w1", version: 2 }, store, async () => ring, seen, () => t);
  assert.equal(first.state, "done");
  assert.equal(first.retired, false); // too soon: a worker may still hold the old current key
  assert.deepEqual(retired, []);
  t += RETIRE_AFTER_MS;
  const second = await rotateWorkspace({ workspaceId: "w1", version: 2 }, store, async () => ring, seen, () => t);
  assert.equal(second.retired, true);
  assert.deepEqual(retired, [{ workspaceId: "w1", below: 2 }]);
});

test("a row changed while the job read it is picked up on the next pass", async () => {
  const rows = await sample();
  const { store } = fakeStore(rows);
  const write = store.writeShared;
  let raced = false;
  store.writeShared = async (table, thread, ws, writes) => {
    if (table === "messages" && !raced) {
      raced = true;
      rows.messages[0].subject = await seal(k1, FIELD.subject, "Edited meanwhile"); // another writer, still on the old key
    }
    return write(table, thread, ws, writes);
  };
  const outcome = await resealWorkspace("w1", store, ring);
  assert.equal(outcome.state, "done");
  assert.equal(await decryptTeamField(k2, FIELD.subject, rows.messages[0].subject as string), "Edited meanwhile");
});
