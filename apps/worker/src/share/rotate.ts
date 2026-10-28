// Team key rotation for a workspace: seals every team value again with the current key before old key versions are
// retired. The long comment further down explains the threat and what rotation does and does not protect.

import { decryptTeamField, encryptTeamBytes, encryptTeamField, isTeamCiphertext, type TeamKeys } from "@messages/crypto";
import { FIELD, type Field } from "@messages/crypto/fields";
import type { Json } from "@messages/db";
import { db, must } from "../db";
import { errorCode, log } from "../log";
import { storageError, uploadObject } from "../storage";
import { teamRingFor, teamStore } from "../vault";
import { openTeamFile } from "./files";
import { resealVoice, supabaseVoice, type VoiceStore } from "./rotate-voice";
import { AI_TEXT, MESSAGE_TEXT, THREAD_TEXT, type RowWrite } from "./reseal";

// TEAM KEY ROTATION: what happens when someone leaves a workspace, and exactly what it does and does not protect.
//
// The problem. Every active member's browser holds the workspace's data key (/api/keys hands it out), so a person
// who leaves still has a copy of it. Without rotation that copy opens everything shared in the team, and everything
// sealed afterwards, for as long as the ciphertext is reachable by them.
//
// The rules.
//  1. Versions. team_keys has one row per version (key_version 1, 2, ...). The highest is the current one: every new
//     value is sealed with it. Values keep their "t1:" tag whichever version sealed them; a reader tries the current
//     version first, then the older ones that still hold values (packages/crypto wrap.ts TeamKeyring).
//  2. When. A removal makes a new version due: team_key_rotation_due(workspace) is true while somebody has been
//     removed since the current version was made (workspace_members.left_at against team_keys.created_at, derived,
//     so remove_member needs no change and nothing can forget it). The next version is made the first time anything
//     asks for the workspace's keys after that: /api/keys, a worker sealing a shared chat, or the check
//     below (every 5 minutes, and at once when a member is removed). A removed member is no longer active, so /api/keys gives them nothing from that moment, and what is
//     sealed from the new version on (workers see it within 30 seconds, the cache time) is unreadable to their copy.
//  3. Re-sealing. This job opens every "t1:" value of the workspace (shared chats, their messages and AI notes, the
//     client list) with the version that sealed it and seals it again with the current one, a page at a time, each
//     write guarded by the old value, so it can be stopped and run again and never overwrites a newer value. When a
//     pass finds nothing left to change and nothing it could not open, the older versions are RETIRED (retired_at):
//     members no longer receive them and the workers no longer read them. From then on the removed member's copy of
//     the old key opens nothing that is stored.
//  3b. Files. A shared chat's sealed attachments each have a team copy (files.ts, attachments.team_path) sealed with the
//     version recorded in team_key_version. The pass opens each copy sealed under an older version, seals it with the
//     current one, uploads it over itself and records the new version (guarded by the old one). A copy that already
//     opens with the current key only has its version recorded. An unreadable copy is counted like any other value and
//     stops the retiring. File names are ordinary t1: values in attachments.filename, sealed again with the messages.
//  3c. The company voice, the log of compliance exports (the client's name) and the team's notes on a chat are t1: values in
//     tables of their own (rotate-voice.ts). The pass seals them again the same way and counts them like any other value.
//  4. Blind indexes. The client list's index tokens (value_index, company_domain_index, domain_index) are always made
//     with the FIRST version's key (TeamKeyring.indexRoot), so they stay valid across versions and no client is added
//     a second time. This job therefore never touches them. The cost: a removed member who kept the first version's
//     key can test guesses against those tokens, but they can no longer read the table.
//  5. Order. Retiring waits RETIRE_AFTER_MS after this process first saw the rotation, longer than the workers' key
//     cache, so a worker still holding the old current key cannot seal something after the last pass.
//
// What it does not do. It cannot take back ciphertext the removed member downloaded before they left, or a database
// backup made before the job ran, and old versions' rows stay in team_keys (retired) as an audit trail: a backup holder
// who also holds a member's old key can read what that backup holds. The agent's own copy of a file stays under
// the agent's key and is not touched. A value this job cannot open under any version is counted, left alone and stops the retiring, so a problem is
// seen rather than hidden.

const PAGE = 100;
/** Files are big, so fewer at a time. */
const FILE_PAGE = 20;
const MAX_PASSES = 4;
/** The safety poll. A removal also runs a pass at once (a Realtime event on workspace_members), and one runs at startup. */
const POLL_MS = 5 * 60_000;
/** Longer than the workers' team key cache (TEAM_RECHECK_MS in vault.ts). */
export const RETIRE_AFTER_MS = 90_000;

/** The keys a pass works with: the current version and the older ones still holding values. */
export interface Ring {
  version: number;
  current: TeamKeys;
  olds: TeamKeys[];
}

/**
 * One value under the current key. null, "", plain text and a user's own value (e1:) are left alone. A value already
 * under the current key is left as it is; one under an older version is opened with it and sealed again. Throws when
 * no version opens it.
 */
export async function resealValue(ring: Ring, field: Field, value: string | null): Promise<string | null> {
  if (value == null || value === "" || !isTeamCiphertext(value)) return value;
  try {
    await decryptTeamField(ring.current, field, value);
    return value;
  } catch {
    // an older version, or a value nothing opens
  }
  for (const old of ring.olds) {
    let plain: string;
    try {
      plain = await decryptTeamField(old, field, value);
    } catch {
      continue;
    }
    return encryptTeamField(ring.current, field, plain);
  }
  throw new Error("unreadable");
}

type Cols = readonly (readonly [string, Field])[];

/** What to write for one row's text columns, or null when all are already current. Throws when one cannot be opened. */
async function resealColumns(ring: Ring, row: Record<string, unknown>, columns: Cols, extra?: (changes: Changes) => Promise<void>): Promise<RowWrite | null> {
  const changes = new Changes();
  for (const [column, field] of columns) changes.note(column, row[column] as string | null, await resealValue(ring, field, row[column] as string | null));
  await extra?.(changes);
  return changes.write(String(row.id ?? row.message_id));
}

class Changes {
  readonly expect: Record<string, Json> = {};
  readonly set: Record<string, Json> = {};
  note(column: string, was: Json, now: Json) {
    if (was === now || JSON.stringify(was) === JSON.stringify(now)) return;
    this.expect[column] = was;
    this.set[column] = now;
  }
  write(id: string): RowWrite | null {
    return Object.keys(this.set).length ? { id, expect: this.expect, set: this.set } : null;
  }
}

/** Rows read for a message: its text, address columns and the WhatsApp quote in provider_meta. */
export async function resealMessage(ring: Ring, row: Record<string, unknown>): Promise<RowWrite | null> {
  return resealColumns(ring, row, MESSAGE_TEXT, async (changes) => {
    const sender = row.sender_address as string | null;
    changes.note("sender_address", sender, await resealValue(ring, FIELD.address, sender));
    const to = (row.to_addresses as string[] | null) ?? [];
    changes.note("to_addresses", to, await Promise.all(to.map(async (a) => (await resealValue(ring, FIELD.address, a)) ?? a)));
    const meta = row.provider_meta as { quoted?: { text?: unknown } } | null;
    if (meta && typeof meta === "object" && meta.quoted && typeof meta.quoted.text === "string") {
      const text = await resealValue(ring, FIELD.quote, meta.quoted.text);
      if (text !== meta.quoted.text) changes.note("provider_meta", row.provider_meta as Json, { ...meta, quoted: { ...meta.quoted, text } } as Json);
    }
  });
}

export const resealThread = (ring: Ring, row: Record<string, unknown>) =>
  resealColumns(ring, row, [...THREAD_TEXT, ["share_label", FIELD.name], ["share_match", FIELD.name]] as Cols);
/** An attachment's name (the bytes are re-sealed separately, resealFiles). Rows are read with their thread. */
export const resealAttachment = (ring: Ring, row: Record<string, unknown>) => resealColumns(ring, row, [["filename", FIELD.filename]] as Cols);
export const resealMessageAi = (ring: Ring, row: Record<string, unknown>) => resealColumns(ring, row, AI_TEXT as Cols);

/** What the job needs of the database (supabaseRotateStore below; the tests use a fake). */
export interface RotateStore {
  /** Workspaces with an unretired version older than the current one, and the current version. */
  due(): Promise<{ workspaceId: string; version: number }[]>;
  /** Up to `limit` rows after the key `after`, in key order. */
  page(table: Table, workspaceId: string, after: string | null, limit: number): Promise<Record<string, unknown>[]>;
  /** The writes of a shared chat's rows, guarded by the old values (share_write). Returns how many were written. */
  writeShared(table: "threads" | "messages" | "message_ai" | "attachments", threadId: string, workspaceId: string, rows: RowWrite[]): Promise<number>;
  /** One client-list row, only if it still holds the old values. */
  writeClient(table: "workspace_contacts" | "workspace_contact_identities" | "workspace_companies", workspaceId: string, key: string, write: RowWrite): Promise<boolean>;
  /** Marks the versions older than `belowVersion` as holding nothing. */
  retire(workspaceId: string, belowVersion: number): Promise<void>;
  /** The copies of shared files; left out, they are not re-sealed (the tests of the text do not need them). */
  files?: TeamFileStore;
  /** The company voice, the export log and the team's notes (rotate-voice.ts); left out, they are not re-sealed. */
  voice?: VoiceStore;
}

/** A team copy of a file, as the pass reads it. */
export interface TeamFileRow {
  id: string;
  thread_id: string;
  team_path: string;
  team_key_version: number | null;
  filename: string | null;
}

/** What re-sealing the copies of files needs of storage (supabaseTeamFiles below; the tests use a fake). */
export interface TeamFileStore {
  /** Up to `limit` copies of the workspace sealed under a version below `belowVersion`, after the id `after`. */
  page(workspaceId: string, belowVersion: number, after: string | null, limit: number): Promise<TeamFileRow[]>;
  read(path: string): Promise<Uint8Array<ArrayBuffer> | null>;
  write(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  /** Records the new version, only while the row still says `was`. */
  mark(workspaceId: string, id: string, was: number | null, now: number): Promise<boolean>;
}

export type Table = "threads" | "messages" | "message_ai" | "attachments" | "workspace_contacts" | "workspace_contact_identities" | "workspace_companies";

const CLIENT_NAME: Cols = [["name", FIELD.name], ["company_name", FIELD.name]];

const TABLES: {
  table: Table;
  /** Keyset paging column, unique within a workspace. */
  key: string;
  build: (ring: Ring, row: Record<string, unknown>) => Promise<RowWrite | null>;
}[] = [
  { table: "threads", key: "id", build: resealThread },
  { table: "messages", key: "id", build: resealMessage },
  { table: "message_ai", key: "message_id", build: resealMessageAi },
  { table: "attachments", key: "id", build: resealAttachment },
  { table: "workspace_contacts", key: "id", build: (ring, row) => resealColumns(ring, row, CLIENT_NAME) },
  { table: "workspace_contact_identities", key: "value_index", build: async (ring, row) => {
    const write = await resealColumns(ring, row, [["value", FIELD.address]]);
    return write && { ...write, id: String(row.value_index) };
  } },
  { table: "workspace_companies", key: "domain_index", build: async (ring, row) => {
    const write = await resealColumns(ring, row, [["name", FIELD.name]]);
    return write && { ...write, id: String(row.domain_index) };
  } },
];

export type RotateOutcome = { state: "done"; moved: number } | { state: "incomplete"; moved: number; failed: number };

/** Re-seals everything of one workspace under the current key. Safe to stop and run again. */
export async function resealWorkspace(workspaceId: string, store: RotateStore, ring: Ring): Promise<RotateOutcome> {
  let moved = 0;
  let failed = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let attempted = 0;
    failed = 0;
    for (const spec of TABLES) {
      let after: string | null = null;
      for (;;) {
        const rows = await store.page(spec.table, workspaceId, after, PAGE);
        if (!rows.length) break;
        const shared = new Map<string, RowWrite[]>();
        for (const row of rows) {
          try {
            const write = await spec.build(ring, row);
            if (!write) continue;
            attempted++;
            if (spec.table === "workspace_contacts" || spec.table === "workspace_contact_identities" || spec.table === "workspace_companies") {
              if (await store.writeClient(spec.table, workspaceId, write.id, write)) moved++;
            } else {
              const thread = String(spec.table === "threads" ? row.id : row.thread_id);
              shared.set(thread, [...(shared.get(thread) ?? []), write]);
            }
          } catch {
            failed++; // a value nothing opens: counted, never logged, and the rest still move
          }
        }
        for (const [thread, writes] of shared) moved += await store.writeShared(spec.table as "threads" | "messages" | "message_ai" | "attachments", thread, workspaceId, writes);
        after = String(rows[rows.length - 1][spec.key]);
        if (rows.length < PAGE) break;
      }
    }
    if (store.files) {
      const outcome = await resealFiles(workspaceId, store.files, ring);
      attempted += outcome.attempted;
      moved += outcome.moved;
      failed += outcome.failed;
    }
    if (store.voice) {
      const outcome = await resealVoice(workspaceId, store.voice, (field, value) => resealValue(ring, field, value));
      attempted += outcome.attempted;
      moved += outcome.moved;
      failed += outcome.failed;
    }
    // A pass that tried to write nothing found nothing to do (or only rows it could not open): it is the last. One that
    // wrote less than it tried met a row changed meanwhile, which the next pass reads again.
    if (attempted === 0) return failed ? { state: "incomplete", moved, failed } : { state: "done", moved };
  }
  return { state: "incomplete", moved, failed };
}

/** The workspace's file copies under an older version, sealed again with the current one. */
export async function resealFiles(workspaceId: string, files: TeamFileStore, ring: Ring): Promise<{ attempted: number; moved: number; failed: number }> {
  let attempted = 0;
  let moved = 0;
  let failed = 0;
  let after: string | null = null;
  for (;;) {
    const rows = await files.page(workspaceId, ring.version, after, FILE_PAGE);
    if (!rows.length) break;
    for (const row of rows) {
      try {
        const sealed = await files.read(row.team_path);
        if (!sealed) { failed++; continue; } // the copy is missing: counted, never hidden
        // Already under the current key (a pass stopped between the upload and the record): only the record is missing.
        if (!(await openTeamFile([ring.current], sealed))) {
          const plain = await openTeamFile(ring.olds, sealed);
          if (!plain) { failed++; continue; }
          attempted++;
          await files.write(row.team_path, await encryptTeamBytes(ring.current, FIELD.attachmentData, plain));
        } else {
          attempted++;
        }
        if (await files.mark(workspaceId, row.id, row.team_key_version, ring.version)) moved++;
      } catch {
        failed++;
      }
    }
    after = rows[rows.length - 1].id;
    if (rows.length < FILE_PAGE) break;
  }
  return { attempted, moved, failed };
}

/** One workspace's turn: re-seal, and retire the old versions when it is clean and the workers' caches have turned over. */
export async function rotateWorkspace(
  item: { workspaceId: string; version: number },
  store: RotateStore,
  ringOf: (workspaceId: string) => Promise<Ring>,
  firstSeen: Map<string, number>,
  now: () => number = Date.now,
): Promise<RotateOutcome & { retired: boolean }> {
  const key = `${item.workspaceId}:${item.version}`;
  if (!firstSeen.has(key)) firstSeen.set(key, now());
  const ring = await ringOf(item.workspaceId);
  const outcome = await resealWorkspace(item.workspaceId, store, ring);
  let retired = false;
  if (outcome.state === "done" && now() - firstSeen.get(key)! >= RETIRE_AFTER_MS) {
    await store.retire(item.workspaceId, ring.version);
    firstSeen.delete(key);
    retired = true;
  }
  return { ...outcome, retired };
}

const omit = (o: Record<string, Json>, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

const SHARED_SELECT: Record<"threads" | "messages" | "message_ai" | "attachments", string> = {
  threads: "id, subject, last_message_preview, summary, share_label, share_match",
  messages: "id, thread_id, subject, preview, body_text, body_html, list_unsubscribe, body_marks, transcript, sender_address, to_addresses, provider_meta",
  message_ai: "message_id, summary, reply_choices, messages!inner(thread_id)",
  attachments: "id, filename, messages!inner(thread_id)",
};
const CLIENT_SELECT = {
  workspace_contacts: "id, name, company_name",
  workspace_contact_identities: "value_index, value",
  workspace_companies: "domain_index, name",
} as const;

export const supabaseTeamFiles: TeamFileStore = {
  async page(workspaceId, belowVersion, after, limit) {
    // The copies below the current version, or without a recorded one.
    let query = db.from("attachments").select("id, team_path, team_key_version, filename, messages!inner(thread_id)")
      .eq("workspace_id", workspaceId).not("team_path", "is", null)
      .or(`team_key_version.is.null,team_key_version.lt.${belowVersion}`).order("id").limit(limit);
    if (after != null) query = query.gt("id", after);
    const rows = must(await query, "load shared files to re-seal");
    return rows.map((r) => ({ id: r.id, thread_id: (r.messages as unknown as { thread_id: string }).thread_id, team_path: r.team_path!, team_key_version: r.team_key_version, filename: r.filename }));
  },
  async read(path) {
    const { data, error } = await db.storage.from("attachments").download(path);
    if (error) {
      if (/not found/i.test(error.message ?? "")) return null;
      throw storageError("storage download", error);
    }
    return new Uint8Array(await data.arrayBuffer());
  },
  write: (path, bytes) => uploadObject("attachments", path, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), "application/octet-stream"),
  async mark(workspaceId, id, was, now) {
    let query = db.from("attachments").update({ team_key_version: now }).eq("id", id).eq("workspace_id", workspaceId);
    query = was === null ? query.is("team_key_version", null) : query.eq("team_key_version", was);
    return must(await query.select("id"), "record file key version").length > 0;
  },
};

export const supabaseRotateStore: RotateStore = {
  files: supabaseTeamFiles,
  voice: supabaseVoice,
  async due() {
    const rows = must(await db.rpc("team_keys_to_reseal"), "load team keys to re-seal");
    return rows.map((r) => ({ workspaceId: r.workspace_id, version: r.current_version }));
  },

  async page(table, workspaceId, after, limit) {
    const key = TABLES.find((t) => t.table === table)!.key;
    const select = table in SHARED_SELECT ? SHARED_SELECT[table as keyof typeof SHARED_SELECT] : CLIENT_SELECT[table as keyof typeof CLIENT_SELECT];
    // The tables are typed one by one; the columns here are chosen by name, so the rows are read as plain records.
    let query = (db.from(table) as unknown as { select(s: string): any }).select(select).eq("workspace_id", workspaceId).order(key).limit(limit);
    if (after != null) query = query.gt(key, after);
    const rows = must(await query, `load ${table} to re-seal`) as Record<string, unknown>[];
    // message_ai has no thread_id of its own: it comes from its message.
    return table === "message_ai" || table === "attachments" ? rows.map((r) => ({ ...r, thread_id: (r.messages as { thread_id: string }).thread_id })) : rows;
  },

  async writeShared(table, threadId, workspaceId, rows) {
    let written = 0;
    // share_write does not list threads.share_match (the client or company a rule matched), so it is written on its own.
    const send = table === "threads" ? rows.filter((r) => Object.keys(r.set).some((k) => k !== "share_match")).map((r) => ({ ...r, set: omit(r.set, "share_match"), expect: omit(r.expect, "share_match") })) : rows;
    if (send.length) written += must(await db.rpc("share_write", { p_thread: threadId, p_workspace: workspaceId, p_table: table, p_rows: send as unknown as Json }), "re-seal shared rows");
    if (table === "threads") {
      for (const r of rows) {
        if (!("share_match" in r.set)) continue;
        const done = must(await db.from("threads").update({ share_match: r.set.share_match as string }).eq("id", r.id).eq("workspace_id", workspaceId).eq("share_match", r.expect.share_match as string).select("id"), "re-seal share match");
        written += done.length;
      }
    }
    return written;
  },

  async writeClient(table, workspaceId, key, write) {
    const keyColumn = table === "workspace_contacts" ? "id" : table === "workspace_contact_identities" ? "value_index" : "domain_index";
    let query = (db.from(table) as unknown as { update(v: unknown): any }).update(write.set).eq("workspace_id", workspaceId).eq(keyColumn, key);
    for (const [column, was] of Object.entries(write.expect)) query = was === null ? query.is(column, null) : query.eq(column, was);
    const done = must(await query.select(keyColumn), `re-seal ${table}`) as unknown[];
    return done.length > 0;
  },

  async retire(workspaceId, belowVersion) {
    must(await db.from("team_keys").update({ retired_at: new Date().toISOString() }).eq("workspace_id", workspaceId).lt("key_version", belowVersion).is("retired_at", null), "retire team keys");
  },
};

async function ring(workspaceId: string): Promise<Ring> {
  const r = await teamRingFor(workspaceId);
  return { version: r.version, current: r.current, olds: r.all.slice(1) };
}

/**
 * Starts the background check: at startup, every 5 minutes (it was 30 seconds: 2 queries each, now 0.4 a minute) and
 * at once when a workspace member row changes (a removal), it makes the next key version for any workspace a removal is waiting
 * on, then re-seals and retires. Work for one workspace at a time; a failure is logged as a code and tried again.
 */
export function startTeamKeyRotation() {
  const firstSeen = new Map<string, number>();
  let running = false;
  let again = false;
  let missingUntil = 0;
  const pass = async () => {
    if (running) { again = true; return; }
    if (Date.now() < missingUntil) return;
    running = true;
    try {
      // Workspaces with a removal: make their next version now rather than waiting for something to ask for the keys.
      const removed = must(await db.from("workspace_members").select("workspace_id").eq("status", "removed"), "load removed members");
      for (const workspaceId of new Set(removed.map((r) => r.workspace_id))) {
        try {
          if ((await teamStore.list(workspaceId)).length && (await teamStore.rotationDue(workspaceId))) await teamRingFor(workspaceId);
        } catch (err) {
          log.error("team key rotation failed", { code: errorCode(err) });
        }
      }
      for (const item of await supabaseRotateStore.due()) {
        try {
          const outcome = await rotateWorkspace(item, supabaseRotateStore, ring, firstSeen);
          log.info("team key re-seal", { workspace: item.workspaceId, version: item.version, state: outcome.state, moved: outcome.moved, retired: outcome.retired });
          if (outcome.state === "incomplete") log.warn("team key re-seal incomplete", { workspace: item.workspaceId, failed: outcome.failed });
        } catch (err) {
          log.error("team key re-seal failed", { workspace: item.workspaceId, code: errorCode(err) });
        }
      }
    } catch (err) {
      if (errorCode(err) === "PGRST202") {
        missingUntil = Date.now() + 10 * 60_000;
        log.warn("team key rotation waits for its migration (20261102300000_team_key_versions.sql)");
      } else {
        log.error("team key rotation failed", { code: errorCode(err) });
      }
    } finally {
      running = false;
    }
    // A removal arrived while this pass ran: it may have missed it.
    if (again) { again = false; void pass(); }
  };
  db.channel("team-key-rotation")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "workspace_members" }, (payload) => {
      if ((payload.new as { status?: string } | null)?.status === "removed") void pass();
    })
    .subscribe();
  void pass();
  setInterval(() => void pass(), POLL_MS);
}
