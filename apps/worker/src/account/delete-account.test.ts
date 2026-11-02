// delete-account.ts: when a request is due, and that the steps run in the safe order and stop on the failures that matter.

import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteEverything, isDue, MAX_ATTEMPTS, STALE_RUNNING_MS, type DeleteDeps } from "./delete-account";
import type { StorageEntry } from "./storage-sweep";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const row = (over: Partial<Parameters<typeof isDue>[0]> = {}) => ({ status: "pending", run_after: "2026-11-20T11:00:00Z", attempts: 0, started_at: null, ...over });

test("a request is due once its grace period is over, not before", () => {
  assert.equal(isDue(row(), NOW), true);
  assert.equal(isDue(row({ run_after: "2026-11-20T12:00:01Z" }), NOW), false);
});

test("a failed request is tried again until it runs out of attempts", () => {
  assert.equal(isDue(row({ status: "failed", attempts: 2 }), NOW), true);
  assert.equal(isDue(row({ status: "failed", attempts: MAX_ATTEMPTS }), NOW), false);
});

test("a running request is left alone unless its worker has gone quiet", () => {
  const fresh = new Date(NOW - 60_000).toISOString();
  const stale = new Date(NOW - STALE_RUNNING_MS - 1000).toISOString();
  assert.equal(isDue(row({ status: "running", started_at: fresh }), NOW), false);
  assert.equal(isDue(row({ status: "running", started_at: stale }), NOW), true);
  assert.equal(isDue(row({ status: "running", started_at: null }), NOW), false);
});

function deps(over: Partial<DeleteDeps> = {}, calls: string[] = []): DeleteDeps {
  const files = new Map<string, StorageEntry[]>([["attachments:u", [{ name: "a", isFolder: false }]], ["avatars:u", []], ["brief-audio:u", []]]);
  return {
    storage: {
      list: async (bucket, folder) => files.get(`${bucket}:${folder}`) ?? [],
      remove: async (bucket, paths) => { calls.push(`remove ${bucket} ${paths.length}`); if (bucket === "attachments" && paths[0] === "u/a") files.set("attachments:u", []); },
    },
    ownsTeamWithMembers: async () => false,
    stopSyncing: async () => { calls.push("stop"); },
    teamFilePaths: async () => ["team/w/1", "team/w/2"],
    shredKeys: async () => { calls.push("shred"); },
    removeEmptyTeams: async () => { calls.push("teams"); },
    deleteAuthUser: async () => { calls.push("auth"); },
    tablesWithRows: async () => [],
    ...over,
  };
}

test("syncing stops, files go, keys are shredded, then the auth user is deleted", async () => {
  const calls: string[] = [];
  const result = await deleteEverything(deps({}, calls), "u");
  assert.deepEqual(calls, ["stop", "remove attachments 2", "remove attachments 1", "shred", "teams", "auth"]);
  assert.equal(result.objects, 3);
});

test("an owner of a team with members is refused before anything is touched", async () => {
  const calls: string[] = [];
  await assert.rejects(deleteEverything(deps({ ownsTeamWithMembers: async () => true }, calls), "u"), { code: "TEAM_OWNER" });
  assert.deepEqual(calls, []);
});

test("rows left behind fail the job instead of reporting success", async () => {
  await assert.rejects(deleteEverything(deps({ tablesWithRows: async () => ["notes"] }), "u"), { code: "LEFTOVER_ROWS" });
});

test("the leftover check covers every table the person owns", async () => {
  let asked: readonly string[] = [];
  await deleteEverything(deps({ tablesWithRows: async (_u, tables) => { asked = tables; return []; } }), "u");
  assert.ok(asked.includes("messages") && asked.includes("user_keys") && asked.includes("account_deletions"));
});

test("a failed file delete stops the job before the keys or the user are touched", async () => {
  const calls: string[] = [];
  const bad = deps({ teamFilePaths: async () => ["team/w/1"] }, calls);
  bad.storage.remove = async () => { throw Object.assign(new Error("x"), { code: "STORAGE_500" }); };
  await assert.rejects(deleteEverything(bad, "u"), { code: "STORAGE_500" });
  assert.ok(!calls.includes("shred") && !calls.includes("auth"));
});
