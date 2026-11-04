// The re-key job's database and storage, over Supabase (job.ts RekeyStore). Every write is guarded by the values that
// were read, so a step that lost a race writes nothing and is planned again. Also says which units a pass walks: every
// table with a user_id (account/owned-tables.ts, the list Delete My Account proves complete against the migrations), the
// sign-in tables found by account_id, and the storage buckets that keep a "<user id>/" folder.

import type { Json } from "@messages/db";
import type { UserKeyRow } from "@messages/crypto/wrap";
import { OWNED_TABLES, USER_BUCKETS } from "../account/owned-tables";
import { listObjects, type StorageLister } from "../account/storage-sweep";
import { db, must } from "../db";
import { storageError, uploadObject } from "../storage";
import type { RekeyStore, Unit } from "./job";

/** Tables never walked: the key tables themselves (rekey_shape refuses them too). */
const NOT_RESEALED = new Set(["user_keys", "user_key_rotations"]);

/** Tables without a user_id that hold a user's sealed values, found through the user's accounts. */
export const ACCOUNT_TABLES = ["account_credentials", "whatsapp_auth_keys", "sync_state"] as const;

/** Every unit of a pass, in order: the user's tables, the account tables, then the storage folders. */
export function rekeyUnits(): Unit[] {
  return [
    ...OWNED_TABLES.filter((t) => !NOT_RESEALED.has(t)).map((name): Unit => ({ kind: "table", name, scope: "user" })),
    ...ACCOUNT_TABLES.map((name): Unit => ({ kind: "table", name, scope: "account" })),
    ...USER_BUCKETS.map((name): Unit => ({ kind: "bucket", name })),
  ];
}

const lister: StorageLister = {
  async list(bucket, folder, offset, pageSize) {
    const { data, error } = await db.storage.from(bucket).list(folder, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw storageError("storage list", error);
    return (data ?? []).map((e) => ({ name: e.name, isFolder: e.id === null }));
  },
  async remove() {
    throw new Error("the re-key job never deletes files");
  },
};

const nowIso = () => new Date().toISOString();

export const supabaseRekeyStore: RekeyStore = {
  async keyRow(userId) {
    return must(await db.from("user_keys").select("*").eq("user_id", userId).maybeSingle(), "load user key") as UserKeyRow | null;
  },

  async rotation(userId) {
    return must(await db.from("user_key_rotations").select("phase, prepared_at, switched_at, clean_pass_at, cursor").eq("user_id", userId).maybeSingle(), "load key rotation") as Awaited<ReturnType<RekeyStore["rotation"]>>;
  },

  async prepare(userId, current, next, index) {
    const patch = { next_wrapped_key: next.wrapped_key, next_wrapped_by: next.wrapped_by, ...(index ? { index_wrapped_key: index.wrapped_key, index_wrapped_by: index.wrapped_by } : {}) };
    let query = db.from("user_keys").update(patch).eq("user_id", userId).eq("wrapped_key", current).is("next_wrapped_key", null).is("previous_wrapped_key", null);
    if (index) query = query.is("index_wrapped_key", null);
    const done = must(await query.select("user_id"), "prepare user key");
    if (!done.length) return false;
    must(await db.from("user_key_rotations").upsert({
      user_id: userId, phase: "prepared", prepared_at: nowIso(), switched_at: null, clean_pass_at: null, cursor: {}, moved: 0, unreadable: 0, finished_at: null, updated_at: nowIso(),
    }, { onConflict: "user_id" }), "record key rotation");
    return true;
  },

  async switchKeys(userId, row) {
    if (!row.next_wrapped_key || !row.next_wrapped_by) return false;
    const done = must(await db.from("user_keys").update({
      wrapped_key: row.next_wrapped_key, wrapped_by: row.next_wrapped_by, previous_wrapped_key: row.wrapped_key, previous_wrapped_by: row.wrapped_by,
      next_wrapped_key: null, next_wrapped_by: null, rotated_at: nowIso(),
    }).eq("user_id", userId).eq("wrapped_key", row.wrapped_key).eq("next_wrapped_key", row.next_wrapped_key).is("previous_wrapped_key", null).select("user_id"), "switch user key");
    if (!done.length) return false;
    must(await db.from("user_key_rotations").update({ phase: "switched", switched_at: nowIso(), cursor: {}, updated_at: nowIso() }).eq("user_id", userId).eq("phase", "prepared"), "record key switch");
    return true;
  },

  async retire(userId, previous) {
    const done = must(await db.from("user_keys").update({ previous_wrapped_key: null, previous_wrapped_by: null }).eq("user_id", userId).eq("previous_wrapped_key", previous).select("user_id"), "retire user key");
    if (!done.length) return false;
    must(await db.from("user_key_rotations").update({ phase: "done", finished_at: nowIso(), cursor: {}, updated_at: nowIso() }).eq("user_id", userId).eq("phase", "switched"), "record key retired");
    return true;
  },

  async saveCursor(userId, cursor, totals) {
    must(await db.from("user_key_rotations").update({ cursor: cursor as unknown as Json, updated_at: nowIso(), ...(totals ?? {}) }).eq("user_id", userId), "save re-key cursor");
  },

  async markClean(userId, passStarted) {
    must(await db.from("user_key_rotations").update({ clean_pass_at: passStarted, updated_at: nowIso() }).eq("user_id", userId), "record clean pass");
  },

  async page(table, scope, userId, after, limit) {
    const rows = must(await db.rpc("rekey_page", { p_table: table, p_scope: scope, p_owner: userId, p_after: (after ?? null) as Json, p_limit: limit }), `load ${table} to re-key`);
    return (rows as unknown as { key: Record<string, unknown>; row: Record<string, unknown> | null; ids?: Record<string, unknown> | null }[]).map((r) => ({ key: r.key, row: r.row ?? {}, ids: r.ids ?? undefined }));
  },

  async write(table, scope, userId, writes) {
    return must(await db.rpc("rekey_write", { p_table: table, p_scope: scope, p_owner: userId, p_rows: writes as unknown as Json }), `re-key ${table}`);
  },

  listFiles: (bucket, userId) => listObjects(lister, bucket, userId),

  async readFile(bucket, path) {
    const { data, error } = await db.storage.from(bucket).download(path);
    if (error) {
      if (/not found/i.test(error.message ?? "")) return null;
      throw storageError("storage download", error);
    }
    return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || "application/octet-stream" };
  },

  writeFile: (bucket, path, bytes, contentType) => uploadObject(bucket, path, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), contentType),
};
