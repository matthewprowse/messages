// The company voice, the export log and the team's notes under a rotated team key (rotate-voice.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptTeamField, deriveTeamKeys, encryptTeamField, type TeamKeys } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
process.env.SUPABASE_URL ??= "http://localhost";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
const { resealWorkspace } = await import("./rotate");
const { resealVoice } = await import("./rotate-voice");
import type { Ring, RotateStore } from "./rotate";
import type { VoiceStore } from "./rotate-voice";

const k1 = await deriveTeamKeys(Uint8Array.from(randomBytes(32)));
const k2 = await deriveTeamKeys(Uint8Array.from(randomBytes(32)));
const ring: Ring = { version: 2, current: k2, olds: [k1] };
const seal = (keys: TeamKeys, field: string, text: string) => encryptTeamField(keys, field, text);
const opens = (keys: TeamKeys, field: string, value: string) => decryptTeamField(keys, field, value).then(() => true, () => false);

type Row = Record<string, unknown>;
type Tables = Record<"workspace_voice_items" | "compliance_exports" | "thread_notes", Row[]>;

/** A fake of the three tables whose write checks the values read, like the real one. */
function fakeVoice(tables: Tables) {
  const writes: { table: string; id: string }[] = [];
  const store: VoiceStore = {
    page: async (table, _select, _ws, after, limit) => tables[table].filter((r) => after == null || String(r.id) > after).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, limit),
    write: async (table, _ws, id, set, expect) => {
      const row = tables[table].find((r) => r.id === id);
      if (!row || Object.entries(expect).some(([c, was]) => (row[c] ?? null) !== was)) return false;
      Object.assign(row, set);
      writes.push({ table, id });
      return true;
    },
  };
  return { store, writes };
}

async function sample(): Promise<Tables> {
  return {
    workspace_voice_items: [
      { id: "a1", kind: "profile", title: null, body: await seal(k1, FIELD.styleRule, "Warm and plain") },
      { id: "a2", kind: "template", title: await seal(k1, FIELD.writingSituation, "Viewing request"), body: await seal(k1, FIELD.writingBody, "When would suit you?") },
      { id: "a3", kind: "fact", title: await seal(k1, FIELD.noteTitle, "Office hours"), body: await seal(k1, FIELD.note, "8 to 5") },
      { id: "a4", kind: "fact", title: await seal(k2, FIELD.noteTitle, "Already current"), body: await seal(k2, FIELD.note, "Fine") },
    ],
    compliance_exports: [{ id: "e1", client_label: await seal(k1, FIELD.name, "Thandi Mokoena") }],
    thread_notes: [{ id: "n1", body: await seal(k1, FIELD.note, "Call her Tuesday") }],
  };
}

test("every sealed value of the voice, the export log and the notes moves to the current key", async () => {
  const tables = await sample();
  const { store, writes } = fakeVoice(tables);
  const reseal = async (field: string, value: string | null) => {
    const { resealValue } = await import("./rotate");
    return resealValue(ring, field as never, value);
  };
  const out = await resealVoice("w1", store, reseal);
  assert.deepEqual(out, { attempted: 5, moved: 5, failed: 0 });
  assert.equal(writes.length, 5);
  assert.equal(await decryptTeamField(k2, FIELD.styleRule, tables.workspace_voice_items[0].body as string), "Warm and plain");
  assert.equal(await decryptTeamField(k2, FIELD.writingSituation, tables.workspace_voice_items[1].title as string), "Viewing request");
  assert.equal(await decryptTeamField(k2, FIELD.writingBody, tables.workspace_voice_items[1].body as string), "When would suit you?");
  assert.equal(await decryptTeamField(k2, FIELD.noteTitle, tables.workspace_voice_items[2].title as string), "Office hours");
  assert.equal(await decryptTeamField(k2, FIELD.name, tables.compliance_exports[0].client_label as string), "Thandi Mokoena");
  assert.equal(await decryptTeamField(k2, FIELD.note, tables.thread_notes[0].body as string), "Call her Tuesday");
  for (const r of [...tables.workspace_voice_items, ...tables.compliance_exports, ...tables.thread_notes]) {
    for (const v of Object.values(r)) if (typeof v === "string" && v.startsWith("t1:")) assert.equal(await opens(k1, FIELD.note, v) || await opens(k1, FIELD.name, v), false, "the old key reads nothing");
  }
  // run again: nothing left to do
  assert.deepEqual(await resealVoice("w1", store, reseal), { attempted: 0, moved: 0, failed: 0 });
});

test("a value nothing opens is counted and left, and a row changed meanwhile is read again", async () => {
  const tables = await sample();
  const stranger = await deriveTeamKeys(Uint8Array.from(randomBytes(32)));
  tables.workspace_voice_items[2].body = await seal(stranger, FIELD.note, "Lost");
  const { store } = fakeVoice(tables);
  const reseal = async (field: string, value: string | null) => (await import("./rotate")).resealValue(ring, field as never, value);
  const out = await resealVoice("w1", store, reseal);
  assert.equal(out.failed, 1);
  assert.equal(out.attempted, 4);
  assert.ok((tables.workspace_voice_items[2].body as string).length > 0, "left as it was");

  // a write that loses the race to a newer value changes nothing
  const raced = await sample();
  const racing = fakeVoice(raced);
  const first = racing.store.write;
  racing.store.write = async (table, ws, id, set, expect) => {
    if (id === "n1") raced.thread_notes[0].body = await seal(k2, FIELD.note, "Newer note");
    return first(table, ws, id, set, expect);
  };
  const again = await resealVoice("w1", racing.store, reseal);
  assert.equal(again.moved, again.attempted - 1);
  assert.equal(await decryptTeamField(k2, FIELD.note, raced.thread_notes[0].body as string), "Newer note");
});

test("the rotation counts these tables, so old versions are not retired while they still hold values", async () => {
  const tables = await sample();
  const { store: voice } = fakeVoice(tables);
  const none: RotateStore = {
    due: async () => [],
    page: async () => [],
    writeShared: async () => 0,
    writeClient: async () => false,
    retire: async () => undefined,
    voice,
  };
  assert.equal((await resealWorkspace("w1", none, ring)).state, "done");
  assert.equal(await decryptTeamField(k2, FIELD.note, tables.thread_notes[0].body as string), "Call her Tuesday");
  // an unreadable value anywhere stops the retiring
  tables.thread_notes.push({ id: "n2", body: await seal(await deriveTeamKeys(Uint8Array.from(randomBytes(32))), FIELD.note, "Lost") });
  const outcome = await resealWorkspace("w1", none, ring);
  assert.equal(outcome.state, "incomplete");
});
