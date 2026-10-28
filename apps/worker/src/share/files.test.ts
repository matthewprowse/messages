// A shared chat's files over fake storage and real keys: the name and the bytes move to the team's key, the agent's own
// object stays, moving back deletes the copy, and a key rotation seals the copies again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptBytes, decryptTeamBytes, decryptTeamField, deriveTeamKeys, deriveUserKeys, encryptBytes, encryptField, encryptTeamBytes, newDataKey, type TeamKeys } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { moveAttachmentFile, teamFilePath, type AttachmentRow, type ShareFiles } from "./files";
import type { Keys, Move, RowWrite } from "./reseal";
process.env.SUPABASE_URL ??= "http://localhost";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
const { resealFiles, resealWorkspace } = await import("./rotate");
import type { Ring, RotateStore, TeamFileRow, TeamFileStore } from "./rotate";

const WS = "ws-1";
const AGENT = "agent-1";
const user = await deriveUserKeys(newDataKey());
const k1 = await deriveTeamKeys(newDataKey());
const k2 = await deriveTeamKeys(newDataKey());
const keys = (team: TeamKeys): Keys => ({ user: async () => user, team: async () => team });
const toWork: Move = { direction: "to_work", userId: AGENT, workspaceId: WS };
const toPersonal: Move = { direction: "to_personal", userId: AGENT, workspaceId: WS };
const bytes = new TextEncoder().encode("%PDF-1.7 the signed mandate") as Uint8Array<ArrayBuffer>;

class FakeStorage implements ShareFiles {
  objects = new Map<string, Uint8Array<ArrayBuffer>>();
  removed: string[] = [];
  constructor(private current: { version: number; keys: TeamKeys }) {}
  team = async () => this.current;
  read = async (path: string) => this.objects.get(path) ?? null;
  write = async (path: string, b: Uint8Array<ArrayBuffer>) => void this.objects.set(path, b);
  remove = async (path: string) => void (this.removed.push(path), this.objects.delete(path));
}

async function row(over: Partial<AttachmentRow> = {}): Promise<AttachmentRow> {
  return { id: "a1", workspace_id: null, filename: await encryptField(user, FIELD.filename, "Mandate.pdf"), sealed: true, storage_path: "agent-1/m1/a1", team_path: null, team_key_version: null, ...over };
}
const apply = (r: AttachmentRow, w: RowWrite | null) => Object.assign(r, w?.set ?? {});

test("sharing seals the name and copies a sealed file under the team key, leaving the agent's object alone", async () => {
  const storage = new FakeStorage({ version: 1, keys: k1 });
  const own = await encryptBytes(user, FIELD.attachmentData, bytes);
  storage.objects.set("agent-1/m1/a1", own);
  const r = await row();
  const write = await moveAttachmentFile(keys(k1), storage, toWork, r);
  assert.ok(write);
  assert.equal(write.set.workspace_id, WS);
  assert.equal(write.set.team_path, teamFilePath(WS, "a1"));
  assert.equal(write.set.team_key_version, 1);
  assert.equal(await decryptTeamField(k1, FIELD.filename, write.set.filename as string), "Mandate.pdf");
  assert.equal(storage.objects.get("agent-1/m1/a1"), own, "the agent's copy is untouched");
  const copy = storage.objects.get(teamFilePath(WS, "a1"))!;
  assert.deepEqual(await decryptTeamBytes(k1, FIELD.attachmentData, copy), bytes);
  await assert.rejects(decryptBytes(user, FIELD.attachmentData, copy), "the agent's key does not open the team copy");
  // Run again on the updated row: nothing is left to do.
  apply(r, write);
  assert.equal(await moveAttachmentFile(keys(k1), storage, toWork, r), null);
});

test("a file stored unsealed or not saved yet gets no copy, and a missing source is not an error", async () => {
  const storage = new FakeStorage({ version: 1, keys: k1 });
  const plain = await moveAttachmentFile(keys(k1), storage, toWork, await row({ sealed: false }));
  assert.equal(plain?.set.team_path, undefined);
  const unsaved = await moveAttachmentFile(keys(k1), storage, toWork, await row({ storage_path: null }));
  assert.equal(unsaved?.set.team_path, undefined);
  const missing = await moveAttachmentFile(keys(k1), storage, toWork, await row());
  assert.equal(missing?.set.team_path, undefined);
  assert.equal(storage.objects.size, 0);
});

test("moving back returns the name to the agent's key and deletes the team copy", async () => {
  const storage = new FakeStorage({ version: 1, keys: k1 });
  storage.objects.set("agent-1/m1/a1", await encryptBytes(user, FIELD.attachmentData, bytes));
  const r = await row();
  apply(r, await moveAttachmentFile(keys(k1), storage, toWork, r));
  assert.ok(storage.objects.has(teamFilePath(WS, "a1")));
  const back = await moveAttachmentFile(keys(k1), storage, toPersonal, r);
  assert.ok(back);
  assert.equal(back.set.workspace_id, null);
  assert.equal(back.set.team_path, null);
  assert.equal(back.set.team_key_version, null);
  assert.deepEqual(storage.removed, [teamFilePath(WS, "a1")]);
  assert.equal(storage.objects.has(teamFilePath(WS, "a1")), false);
  assert.ok(storage.objects.has("agent-1/m1/a1"));
  apply(r, back);
  assert.equal(await decryptBytes(user, FIELD.attachmentData, storage.objects.get("agent-1/m1/a1")!).then((b) => new TextDecoder().decode(b)), "%PDF-1.7 the signed mandate");
  assert.equal(await moveAttachmentFile(keys(k1), storage, toPersonal, r), null);
});

// Rotation.
const ring: Ring = { version: 2, current: k2, olds: [k1] };

function fakeFiles(rows: (TeamFileRow & { workspace: string })[], storage: Map<string, Uint8Array<ArrayBuffer>>): TeamFileStore {
  return {
    page: async (ws, below, after, limit) =>
      rows.filter((r) => r.workspace === ws && (r.team_key_version == null || r.team_key_version < below) && (after == null || r.id > after)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit),
    read: async (path) => storage.get(path) ?? null,
    write: async (path, b) => void storage.set(path, b),
    mark: async (_ws, id, was, now) => {
      const r = rows.find((x) => x.id === id);
      if (!r || r.team_key_version !== was) return false;
      r.team_key_version = now;
      return true;
    },
  };
}
const fileRow = (id: string, version: number | null): TeamFileRow & { workspace: string } => ({ id, thread_id: "t1", team_path: teamFilePath(WS, id), team_key_version: version, filename: null, workspace: WS });

test("a key rotation seals the team copies again, the old key opens nothing after it, and a second run does nothing", async () => {
  const storage = new Map<string, Uint8Array<ArrayBuffer>>();
  const rows = [fileRow("a1", 1), fileRow("a2", 1), fileRow("a3", 2)];
  storage.set(teamFilePath(WS, "a1"), await encryptTeamBytes(k1, FIELD.attachmentData, bytes));
  storage.set(teamFilePath(WS, "a2"), await encryptTeamBytes(k1, FIELD.attachmentData, bytes));
  const current = await encryptTeamBytes(k2, FIELD.attachmentData, bytes);
  storage.set(teamFilePath(WS, "a3"), current);
  const files = fakeFiles(rows, storage);
  const out = await resealFiles(WS, files, ring);
  assert.deepEqual(out, { attempted: 2, moved: 2, failed: 0 });
  for (const id of ["a1", "a2"]) {
    const sealed = storage.get(teamFilePath(WS, id))!;
    assert.deepEqual(await decryptTeamBytes(k2, FIELD.attachmentData, sealed), bytes);
    await assert.rejects(decryptTeamBytes(k1, FIELD.attachmentData, sealed));
  }
  assert.equal(storage.get(teamFilePath(WS, "a3")), current, "a current copy is left as it is");
  assert.deepEqual(rows.map((r) => r.team_key_version), [2, 2, 2]);
  assert.deepEqual(await resealFiles(WS, files, ring), { attempted: 0, moved: 0, failed: 0 });
});

test("a copy already under the current key (an interrupted pass) only has its version recorded", async () => {
  const storage = new Map<string, Uint8Array<ArrayBuffer>>();
  const rows = [fileRow("a1", 1)];
  const done = await encryptTeamBytes(k2, FIELD.attachmentData, bytes);
  storage.set(teamFilePath(WS, "a1"), done);
  const out = await resealFiles(WS, fakeFiles(rows, storage), ring);
  assert.deepEqual(out, { attempted: 1, moved: 1, failed: 0 });
  assert.equal(storage.get(teamFilePath(WS, "a1")), done);
  assert.equal(rows[0].team_key_version, 2);
});

test("a copy nothing opens, or a missing one, is counted and left alone, and keeps the workspace incomplete", async () => {
  const storage = new Map<string, Uint8Array<ArrayBuffer>>();
  const stranger = await deriveTeamKeys(newDataKey());
  const bad = await encryptTeamBytes(stranger, FIELD.attachmentData, bytes);
  storage.set(teamFilePath(WS, "a1"), bad);
  const rows = [fileRow("a1", 1), fileRow("a2", 1)]; // a2 has no object
  const files = fakeFiles(rows, storage);
  assert.deepEqual(await resealFiles(WS, files, ring), { attempted: 0, moved: 0, failed: 2 });
  assert.equal(storage.get(teamFilePath(WS, "a1")), bad);
  const store: RotateStore = {
    due: async () => [], page: async () => [], writeShared: async () => 0, writeClient: async () => false, retire: async () => undefined, files,
  };
  const outcome = await resealWorkspace(WS, store, ring);
  assert.equal(outcome.state, "incomplete");
});

test("a file name goes through the same re-seal as the messages' text", async () => {
  const { resealAttachment } = await import("./rotate");
  const { encryptTeamField } = await import("@messages/crypto");
  const old = await encryptTeamField(k1, FIELD.filename, "Mandate.pdf");
  const write = await resealAttachment(ring, { id: "a1", filename: old });
  assert.ok(write);
  assert.equal(await decryptTeamField(k2, FIELD.filename, write.set.filename as string), "Mandate.pdf");
  assert.equal(await resealAttachment(ring, { id: "a1", filename: write.set.filename }), null);
});
