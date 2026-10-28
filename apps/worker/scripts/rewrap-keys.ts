// One-off (docs/PLAN.md, Google Cloud KMS, Migration): moves every data key from the local wrapper (local:v1,
// KEY_WRAPPING_KEY) to Google Cloud KMS (kms:v1). The data keys themselves do not change, so nothing that was
// encrypted with them is touched or re-encrypted: only the small wrapped copy in user_keys and team_keys is replaced.
//
//   pnpm rewrap-keys            Dry run, the default. Unwraps each local:v1 key, wraps it with KMS, unwraps that again
//                               and checks it is the same key, and writes nothing. It does call KMS (one Encrypt and
//                               one Decrypt per key), so it also proves the KMS key, its IAM and the token work.
//   pnpm rewrap-keys --apply    Writes the kms:v1 copies.
//
// Needs KMS_KEY_NAME, KEY_WRAPPING_KEY and Google credentials (GOOGLE_APPLICATION_CREDENTIALS_JSON, or a VM with a
// service account). A row is written only if it still holds the local:v1 value that was read, so a run can be
// stopped and started again, and a key changed meanwhile is left for the next run. Keep KEY_WRAPPING_KEY until a
// dry run reports 0 left to move AND the backups made before the move are no longer wanted, then remove it everywhere.
// Team keys of every version are moved, retired ones included (they are only audit rows, but stay openable).

import { kmsWrapper, googleAccessToken, localWrapper } from "@messages/crypto/wrap";
import { allRows, db, must } from "../src/db";
import { env } from "../src/env";

const apply = process.argv.includes("--apply");
if (process.argv.some((a) => a.startsWith("--") && a !== "--apply" && a !== "--dry-run")) {
  console.error("Usage: pnpm rewrap-keys [--dry-run | --apply]");
  process.exit(1);
}
if (!env.kmsKeyName || !env.keyWrappingKey) {
  console.error("Set KMS_KEY_NAME and KEY_WRAPPING_KEY in apps/worker/.env first.");
  process.exit(1);
}

const local = await localWrapper(env.keyWrappingKey);
const kms = kmsWrapper({ keyName: env.kmsKeyName, token: googleAccessToken() });

let moved = 0;
let failed = 0;
let alreadyKms = 0;

async function same(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Rewraps one key. `write` stores the new value only if the row still holds `old`. */
async function move(label: string, old: string, ownerId: string, scope: "user" | "team", write: (wrapped: string) => Promise<number>) {
  try {
    const key = await local.unwrap(old, ownerId, scope);
    const wrapped = await kms.wrap(key, ownerId, scope);
    const back = await kms.unwrap(wrapped, ownerId, scope);
    if (!(await same(key, back))) throw new Error("round trip differs");
    key.fill(0);
    back.fill(0);
    if (apply) {
      const n = await write(wrapped);
      if (n === 0) {
        console.log(`${label} ${ownerId}: changed meanwhile, left for the next run`);
        return;
      }
    }
    moved++;
  } catch (err) {
    failed++;
    console.error(`${label} ${ownerId}: not moved (${(err as { code?: string }).code ?? (err as Error).message})`);
  }
}

const users = await allRows((from, to) => db.from("user_keys").select("user_id, wrapped_key, wrapped_by").order("user_id").range(from, to), "load user keys");
for (const row of users) {
  if (row.wrapped_by === "kms:v1") { alreadyKms++; continue; }
  if (row.wrapped_by !== "local:v1") { failed++; console.error(`user_keys ${row.user_id}: unknown wrapper ${row.wrapped_by}`); continue; }
  await move("user_keys", row.wrapped_key, row.user_id, "user", async (wrapped) => {
    const updated = must(
      await db.from("user_keys").update({ wrapped_key: wrapped, wrapped_by: "kms:v1" }).eq("user_id", row.user_id).eq("wrapped_by", "local:v1").eq("wrapped_key", row.wrapped_key).select("user_id"),
      "rewrap user key",
    );
    return updated.length;
  });
}

const teams = await allRows((from, to) => db.from("team_keys").select("workspace_id, key_version, wrapped_key, wrapped_by").order("workspace_id").order("key_version").range(from, to), "load team keys");
for (const row of teams) {
  if (row.wrapped_by === "kms:v1") { alreadyKms++; continue; }
  if (row.wrapped_by !== "local:v1") { failed++; console.error(`team_keys ${row.workspace_id}: unknown wrapper ${row.wrapped_by}`); continue; }
  await move("team_keys", row.wrapped_key, row.workspace_id, "team", async (wrapped) => {
    const updated = must(
      await db.from("team_keys").update({ wrapped_key: wrapped, wrapped_by: "kms:v1" }).eq("workspace_id", row.workspace_id).eq("key_version", row.key_version).eq("wrapped_by", "local:v1").eq("wrapped_key", row.wrapped_key).select("workspace_id"),
      "rewrap team key",
    );
    return updated.length;
  });
}

console.log(`${apply ? "Rewrapped" : "Would rewrap"} ${moved} keys (${users.length} user rows, ${teams.length} team rows), ${alreadyKms} already kms:v1, ${failed} failed.${apply ? "" : " Nothing was written. Run again with --apply."}`);
process.exit(failed ? 1 : 0);
