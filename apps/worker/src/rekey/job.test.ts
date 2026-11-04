// rekey/job.ts end to end on a fake database and storage: a user's key is prepared, switched after the caches turn over,
// every value and file is re-sealed, and the old key is retired only after a clean pass well after the switch. The blind
// index stays the same throughout, the dry run writes nothing, and a stopped pass resumes.

import assert from "node:assert/strict";
import { test } from "node:test";
import { blindIndex, decryptBytes, decryptField, deriveUserKeyring, encryptBytes, encryptField, placeOf } from "@messages/crypto";
import { addressKey } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import { deriveCredentialKey, localWrapper, openCredential, sealCredential, userKeyringFor, type UserKeyRow } from "@messages/crypto/wrap";
import { bindPass, runPass, stepUser, type RekeyStore, type Unit } from "./job";
import { GRACE_MS, resumeCursor, TURNOVER_MS, type PassCursor, type RotationRow } from "./plan";
import type { RekeyWrite } from "./reseal";

const USER = "0b6a3c1e-7f2d-4c55-9a1b-2e3f4a5b6c7d";
const MASTER = Buffer.alloc(32, 7).toString("base64");
const T0 = Date.parse("2026-11-04T10:00:00Z");

type Row = { key: Record<string, unknown>; row: Record<string, unknown> };

class FakeStore implements RekeyStore {
  keys: UserKeyRow;
  rot: (RotationRow & { cursor: unknown; moved?: number }) | null = null;
  tables = new Map<string, Row[]>();
  files = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>();
  writes = 0;
  failPageAt: number | null = null;
  pages = 0;
  constructor(keys: UserKeyRow, private now: () => number) { this.keys = keys; }
  async keyRow() { return { ...this.keys }; }
  async rotation() { return this.rot && { ...this.rot }; }
  async prepare(_u: string, current: string, next: { wrapped_key: string; wrapped_by: string }, index: { wrapped_key: string; wrapped_by: string } | null) {
    if (this.keys.wrapped_key !== current || this.keys.next_wrapped_key) return false;
    this.keys = { ...this.keys, next_wrapped_key: next.wrapped_key, next_wrapped_by: next.wrapped_by, ...(index ? { index_wrapped_key: index.wrapped_key, index_wrapped_by: index.wrapped_by } : {}) };
    this.rot = { phase: "prepared", prepared_at: new Date(this.now()).toISOString(), switched_at: null, clean_pass_at: null, cursor: {} };
    return true;
  }
  async switchKeys(_u: string, row: UserKeyRow) {
    if (this.keys.wrapped_key !== row.wrapped_key || !this.keys.next_wrapped_key) return false;
    this.keys = { ...this.keys, wrapped_key: row.next_wrapped_key!, wrapped_by: row.next_wrapped_by!, previous_wrapped_key: row.wrapped_key, previous_wrapped_by: row.wrapped_by, next_wrapped_key: null, next_wrapped_by: null };
    this.rot = { ...this.rot!, phase: "switched", switched_at: new Date(this.now()).toISOString(), cursor: {} };
    return true;
  }
  async retire(_u: string, previous: string) {
    if (this.keys.previous_wrapped_key !== previous) return false;
    this.keys = { ...this.keys, previous_wrapped_key: null, previous_wrapped_by: null };
    this.rot = { ...this.rot!, phase: "done", cursor: {} };
    return true;
  }
  async saveCursor(_u: string, cursor: PassCursor | Record<string, never>) { this.rot = { ...this.rot!, cursor }; }
  async markClean(_u: string, started: string) { this.rot = { ...this.rot!, clean_pass_at: started }; }
  async page(table: string, _s: string, _u: string, after: unknown, limit: number) {
    if (this.failPageAt !== null && this.pages++ === this.failPageAt) throw Object.assign(new Error("stopped"), { code: "STOPPED" });
    const rows = this.tables.get(table) ?? [];
    const start = after ? rows.findIndex((r) => JSON.stringify(r.key) === JSON.stringify(after)) + 1 : 0;
    return rows.slice(start, start + limit).map((r) => ({ key: { ...r.key }, row: structuredClone(r.row) }));
  }
  async write(table: string, _s: string, _u: string, writes: RekeyWrite[]) {
    let n = 0;
    for (const w of writes) {
      const row = this.tables.get(table)!.find((r) => JSON.stringify(r.key) === JSON.stringify(w.key))!;
      if (Object.entries(w.expect).every(([c, v]) => JSON.stringify(row.row[c]) === JSON.stringify(v))) {
        Object.assign(row.row, w.set);
        n++;
        this.writes++;
      }
    }
    return n;
  }
  async listFiles(bucket: string) { return [...this.files.keys()].filter((k) => k.startsWith(`${bucket}/`)).map((k) => k.slice(bucket.length + 1)); }
  async readFile(bucket: string, path: string) { return this.files.get(`${bucket}/${path}`) ?? null; }
  async writeFile(bucket: string, path: string, bytes: Uint8Array<ArrayBuffer>, contentType: string) { this.files.set(`${bucket}/${path}`, { bytes, contentType }); this.writes++; }
}

const UNITS: Unit[] = [{ kind: "table", name: "messages", scope: "user" }, { kind: "table", name: "account_credentials", scope: "account" }, { kind: "bucket", name: "attachments" }];

async function setUp() {
  const wrapper = await localWrapper(MASTER);
  const oldKey = Uint8Array.from({ length: 32 }, (_, i) => i);
  let at = T0;
  const store = new FakeStore({ wrapped_key: await wrapper.wrap(oldKey, USER), wrapped_by: "local:v1" }, () => at);
  const oldKeys = await deriveUserKeyring(oldKey);
  const oldCred = await deriveCredentialKey(oldKey);
  store.tables.set("messages", await Promise.all(Array.from({ length: 150 }, async (_, i) => ({
    key: { id: `m${String(i).padStart(3, "0")}` },
    row: { body_text: await encryptField(oldKeys, FIELD.body, `body ${i}`), sender_address: await encryptField(oldKeys, FIELD.address, "sam@example.com") },
  }))));
  store.tables.set("account_credentials", [{ key: { account_id: "acc" }, row: { ciphertext: await sealCredential(oldCred, "acc", "{}"), refreshed: null } }]);
  store.files.set(`attachments/${USER}/m1/a1`, { bytes: await encryptBytes(oldKeys, FIELD.attachmentData, Uint8Array.of(1, 2, 3)), contentType: "application/pdf" });
  const deps = { store, wrappers: [wrapper], units: UNITS, now: () => at };
  return { store, deps, wrapper, oldKeys, advance: (ms: number) => { at += ms; } };
}

async function currentKeys(store: FakeStore, wrapper: Awaited<ReturnType<typeof localWrapper>>) {
  const ring = await userKeyringFor({ read: async () => store.keys, insertIfAbsent: async () => undefined }, [wrapper], USER);
  return { keys: await deriveUserKeyring(ring.current, [], ring.indexKey), cred: await deriveCredentialKey(ring.current), older: ring.older.length };
}

test("a rotation runs from prepare to retire, and leaves everything under the new key with the same index tokens", async () => {
  const { store, deps, wrapper, oldKeys, advance } = await setUp();
  const tokenBefore = await blindIndex(oldKeys, addressKey("sam@example.com"));
  const opts = { apply: true, start: true };

  assert.equal((await stepUser(deps, USER, opts)).step.kind, "prepare");
  assert.ok(store.keys.next_wrapped_key && store.keys.index_wrapped_key);
  assert.equal((await stepUser(deps, USER, opts)).step.kind, "wait");
  advance(TURNOVER_MS);
  assert.equal((await stepUser(deps, USER, opts)).step.kind, "switch");
  assert.ok(store.keys.previous_wrapped_key && !store.keys.next_wrapped_key);

  const first = await stepUser(deps, USER, opts);
  assert.equal(first.step.kind, "reseal");
  assert.equal(first.clean, false, "the first pass moves everything");
  assert.equal(store.writes, 150 + 1 + 1);
  advance(60_000);
  const second = await stepUser(deps, USER, opts);
  assert.equal(second.clean, true);
  assert.equal((await stepUser(deps, USER, opts)).step.kind, "wait", "clean, but too soon after the switch to retire");
  advance(GRACE_MS);
  assert.equal((await stepUser(deps, USER, opts)).clean, true);
  assert.equal((await stepUser(deps, USER, opts)).step.kind, "retire");
  assert.equal(store.keys.previous_wrapped_key, null);
  assert.equal(store.rot!.phase, "done");

  const now = await currentKeys(store, wrapper);
  assert.equal(now.older, 0);
  const msgs = store.tables.get("messages")!;
  assert.equal(await decryptField(now.keys, FIELD.body, msgs[7].row.body_text as string), "body 7");
  assert.equal(await decryptField(now.keys, FIELD.address, msgs[149].row.sender_address as string), "sam@example.com");
  await assert.rejects(decryptField(oldKeys, FIELD.body, msgs[7].row.body_text as string));
  assert.equal(await openCredential(now.cred, "acc", store.tables.get("account_credentials")![0].row.ciphertext as string), "{}");
  const file = store.files.get(`attachments/${USER}/m1/a1`)!;
  assert.deepEqual(await decryptBytes(now.keys, FIELD.attachmentData, file.bytes), Uint8Array.of(1, 2, 3));
  assert.equal(file.contentType, "application/pdf");
  assert.equal(await blindIndex(now.keys, addressKey("sam@example.com")), tokenBefore, "no index token changes");
});

test("the dry run counts what would move and writes nothing", async () => {
  const { store, deps } = await setUp();
  const out = await stepUser(deps, USER, { apply: false, start: true });
  assert.equal(out.step.kind, "prepare");
  assert.equal(store.writes, 0);
  assert.equal(store.keys.next_wrapped_key, undefined);
  // Before a rotation everything is under the current key.
  assert.equal(out.report!.find((r) => r.unit === "messages")!.tally.current, 300);
  assert.equal(out.clean, true);
});

test("a unit that fails makes the pass unclean, and the next pass moves what it had not reached", async () => {
  const { store, deps, advance } = await setUp();
  const opts = { apply: true, start: true };
  await stepUser(deps, USER, opts);
  advance(TURNOVER_MS);
  await stepUser(deps, USER, opts);
  store.failPageAt = 1; // the second page of messages
  const stopped = await stepUser(deps, USER, opts);
  assert.equal(stopped.clean, false);
  assert.equal(stopped.report!.find((r) => r.unit === "messages")!.error, "STOPPED");
  store.failPageAt = null;
  // The failed unit made the pass unclean; the next pass picks up the rest.
  const next = await stepUser(deps, USER, opts);
  assert.equal(next.report!.find((r) => r.unit === "messages")!.tally.moved, 100, "the 50 rows not reached, two values each");
});

test("runPass continues a unit from the key it reached", async () => {
  const { store, deps } = await setUp();
  const ring = { current: { keys: await deriveUserKeyring(Uint8Array.from({ length: 32 }, () => 9)), credential: await deriveCredentialKey(Uint8Array.from({ length: 32 }, () => 9)) }, olds: [] };
  const cursor = { ...resumeCursor(null, T0), unit: "messages", after: { id: "m099" } };
  const { report } = await runPass(deps, USER, ring, cursor, false);
  const messages = report.find((r) => r.unit === "messages")!;
  assert.equal(messages.tally.unreadable, 100, "50 rows from m100 on, two values each, none under this key");
  assert.equal(store.writes, 0);
});

test("a rotation with bind on leaves every value and file bound to its place, and a bind pass alone does the same without a rotation", async () => {
  const { store, deps, wrapper, advance } = await setUp();
  const bound = { ...deps, bind: true };
  const opts = { apply: true, start: true };
  await stepUser(bound, USER, opts); // prepare
  advance(TURNOVER_MS);
  await stepUser(bound, USER, opts); // switch
  await stepUser(bound, USER, opts); // reseal
  const { keys } = await currentKeys(store, wrapper);
  const ringNow = await userKeyringFor({ read: async () => store.keys, insertIfAbsent: async () => undefined }, [wrapper], USER);
  const mine = await deriveUserKeyring(ringNow.current, [], ringNow.indexKey, USER);
  const msg = store.tables.get("messages")![0].row;
  assert.deepEqual(placeOf(msg.body_text as string), { place: "messages.body_text", row: "" });
  assert.equal(await decryptField(mine, FIELD.body, msg.body_text as string), "body 0");
  await assert.rejects(decryptField(keys, FIELD.body, msg.body_text as string), "a bound value needs the owner on the keys");
  const file = store.files.get(`attachments/${USER}/m1/a1`)!.bytes;
  assert.deepEqual(await decryptBytes(mine, FIELD.attachmentData, file, `attachments/${USER}/m1/a1`), Uint8Array.of(1, 2, 3));

  // A second user with legacy values and no rotation: bindPass binds them, writes no cursor, and a second run finds nothing.
  const fresh = await setUp();
  const before = JSON.stringify(fresh.store.rot);
  const first = await bindPass(fresh.deps, USER, true);
  assert.equal(first.cursor.moved > 0, true);
  assert.equal(JSON.stringify(fresh.store.rot), before, "no rotation state is touched");
  const second = await bindPass(fresh.deps, USER, true);
  assert.equal(second.cursor.moved, 0);
});
