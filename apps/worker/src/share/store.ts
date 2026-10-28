import { FIELD } from "@messages/crypto/fields";
import type { Json } from "@messages/db";
import { db, must } from "../db";
import { storageError, storageStatus, uploadObject } from "../storage";
import { open, keysFor, teamKeysFor, teamRingFor } from "../vault";
import type { ShareFiles } from "./files";
import type { Keys, LabelSource, MessageAiRow, MessageRow, RowWrite, ThreadRow } from "./reseal";
import type { ShareStore, ShareTable } from "./process";

// The Supabase side of a share job. The functions it calls are in 20261101120000_shared_chats.sql.

export const keys: Keys = { user: keysFor, team: teamKeysFor };

const THREAD_COLUMNS = "id, user_id, workspace_id, share_from, last_message_at, subject, last_message_preview, summary, share_label, is_group, group_name, shared_by";

const PENDING = { messages: "share_pending_messages", message_ai: "share_pending_message_ai", attachments: "share_pending_attachments" } as const;

export const supabaseStore: ShareStore = {
  async thread(id) {
    return must(await db.from("threads").select(THREAD_COLUMNS).eq("id", id).maybeSingle(), "load shared chat") as ThreadRow | null;
  },

  async isActiveMember(workspaceId, userId) {
    const row = must(await db.from("workspace_members").select("status").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle(), "load member");
    return row?.status === "active";
  },

  pending: (async (table: keyof typeof PENDING, threadId: string, direction: string, after: string | null, limit: number) =>
    must(await db.rpc(PENDING[table], { p_thread: threadId, p_direction: direction, p_after: after, p_limit: limit }), "load rows to share")) as unknown as ShareStore["pending"],

  async write(table: ShareTable | "threads", threadId: string, workspaceId: string | null, rows: RowWrite[]) {
    return must(await db.rpc("share_write", { p_thread: threadId, p_workspace: workspaceId, p_table: table, p_rows: rows as unknown as Json }), "write shared rows");
  },

  async labelSource(thread: ThreadRow): Promise<LabelSource> {
    const people = must(await db.from("thread_participants").select("contacts(display_name)").eq("thread_id", thread.id), "load chat people");
    const names = await Promise.all(people.map((p) => open(thread.user_id, FIELD.name, p.contacts?.display_name, thread.workspace_id)));
    return {
      groupName: thread.is_group ? thread.group_name : null,
      contactNames: names.filter((n): n is string => !!n),
      subject: await open(thread.user_id, FIELD.subject, thread.subject, thread.workspace_id),
    };
  },
};

export type { MessageAiRow, MessageRow };

const BUCKET = "attachments";

/** Copies of a shared chat's sealed files, kept in the attachments bucket (files.ts). */
export const supabaseFiles: ShareFiles = {
  async team(workspaceId) {
    const ring = await teamRingFor(workspaceId);
    return { version: ring.version, keys: ring.current };
  },
  async read(path) {
    const { data, error } = await db.storage.from(BUCKET).download(path);
    if (error) {
      const status = storageStatus(error);
      if (status === 404 || status === 400 || /not found/i.test(error.message ?? "")) return null;
      throw storageError("storage download", error);
    }
    return new Uint8Array(await data.arrayBuffer());
  },
  write: (path, bytes) => uploadObject(BUCKET, path, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), "application/octet-stream"),
  async remove(path) {
    const { error } = await db.storage.from(BUCKET).remove([path]);
    if (error) throw storageError("storage remove", error);
  },
};
