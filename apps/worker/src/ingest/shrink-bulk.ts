// Shortens old bulk mail (newsletters, marketing, automated) to a preview, because its sealed text and bold/italic
// marks are most of the messages table. Mail older than 30 days with messages.is_bulk keeps about its first 500
// characters in body_text, loses body_marks, and gets body_shrunk_at. The full email is still read through View
// Original, which fetches it from the provider using provider_meta (folder, uid, uid_validity), none of which is
// touched here. The subject, preview, summaries and embeddings are left as they are.
//
// Never shortened: mail that is not bulk, mail under 30 days old, a workspace's shared mail, a conversation you replied
// in, one with an active draft or pinned, and mail from someone you have written to. Each message is one update
// guarded by body_shrunk_at being null, so a second run, or two at once, cannot shorten it twice. A message whose key
// cannot be opened is skipped and counted, never written as plain text.

import { FIELD } from "@messages/crypto/fields";
import { isCiphertext } from "@messages/crypto";
import { errorCode, log } from "../log";

export const SHRINK_AFTER_DAYS = 30;
export const PREVIEW_CHARS = 500;
const DAY_MS = 24 * 60 * 60_000;

/** The first ~500 characters of text, cut at a word boundary (never inside a character). Short text comes back unchanged. */
export function previewOf(text: string, max = PREVIEW_CHARS): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  let end = max;
  // Cut at the last whitespace unless the text before it would be less than half of the preview.
  if (!/\s/u.test(chars[max])) {
    let back = max;
    while (back > 0 && !/\s/u.test(chars[back - 1])) back--;
    if (back >= max / 2) end = back;
  }
  return chars.slice(0, end).join("").trimEnd();
}

export interface Candidate {
  id: string;
  user_id: string;
  thread_id: string;
  sender_index: string | null;
  sent_at: string;
  body_text: string | null;
  body_marks: string | null;
}

export interface ShrinkDeps {
  now: () => number;
  /** Unshortened bulk mail older than cutoff, oldest first, sent after `after` when given. */
  candidates: (cutoff: string, after: string | null, n: number) => Promise<Candidate[]>;
  /** Of these conversations, the ones with an outbound message. */
  repliedThreads: (ids: string[]) => Promise<Set<string>>;
  /** Of these conversations, the ones pinned or with an active draft. */
  heldThreads: (ids: string[]) => Promise<Set<string>>;
  /** Whether the user has sent mail to this sender (by blind index). */
  writtenTo: (userId: string, senderIndex: string) => Promise<boolean>;
  open: (userId: string, text: string) => Promise<string | null>;
  seal: (userId: string, text: string) => Promise<string | null>;
  sealing: () => boolean;
  /** One guarded update; true when the row was still unshortened and is now. */
  apply: (id: string, patch: { body_text: string | null; body_marks: null; body_shrunk_at: string }) => Promise<boolean>;
  /** Where the next pass starts, so mail that is skipped does not block the queue. */
  cursor: { after: string | null };
}

export interface ShrinkResult {
  shrunk: number;
  skipped: number;
  keyErrors: number;
  bytesBefore: number;
  bytesAfter: number;
}

const defaultCursor: { after: string | null } = { after: null };

// body_shrunk_at is not in the generated database types until the migration is applied and they are regenerated.
type Loose = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The database and vault are loaded on first use, so the rules above can be tested without a configured worker. */
async function realDeps(): Promise<ShrinkDeps> {
  const { db, must } = await import("../db");
  const { openStrict, seal, sealing } = await import("../vault");
  const loose = () => db as unknown as Loose;
  return {
    now: () => Date.now(),
    async candidates(cutoff, after, n) {
      let q = loose().from("messages").select("id, user_id, thread_id, sender_index, sent_at, body_text, body_marks")
        .eq("is_bulk", true).eq("direction", "inbound").is("body_shrunk_at", null).is("workspace_id", null).lt("sent_at", cutoff);
      if (after) q = q.gt("sent_at", after);
      return must(await q.order("sent_at", { ascending: true }).limit(n), "load bulk mail to shorten") as Candidate[];
    },
    async repliedThreads(ids) {
      const rows = must(await db.from("messages").select("thread_id").in("thread_id", ids).eq("direction", "outbound"), "load replied conversations");
      return new Set(rows.map((r) => r.thread_id).filter((t): t is string => t !== null));
    },
    async heldThreads(ids) {
      const pinned = must(await db.from("threads").select("id").in("id", ids).eq("pinned", true), "load pinned conversations");
      const drafts = must(await db.from("drafts").select("thread_id").in("thread_id", ids).eq("status", "active"), "load conversations with drafts");
      return new Set([...pinned.map((r) => r.id), ...drafts.map((r) => r.thread_id).filter((t): t is string => t !== null)]);
    },
    async writtenTo(userId, senderIndex) {
      const rows = must(await db.from("messages").select("id").eq("user_id", userId).eq("direction", "outbound").contains("to_indexes", [senderIndex]).limit(1), "check for mail sent to sender");
      return rows.length > 0;
    },
    // openStrict throws on a key that does not work (open() would give "" and a preview of nothing would be sealed).
    open: (userId, text) => openStrict(userId, FIELD.body, text),
    seal: (userId, text) => seal(userId, FIELD.body, text),
    sealing,
    async apply(id, patch) {
      const rows = must(await loose().from("messages").update(patch).eq("id", id).is("body_shrunk_at", null).select("id"), "shorten bulk mail") as { id: string }[];
      return rows.length > 0;
    },
    cursor: defaultCursor,
  };
}

/**
 * Shortens up to `limit` old bulk messages, oldest first, and says what it did. Safe to run on any schedule and
 * from several workers at once.
 */
export async function shrinkOldBulk(limit = 50, deps: Partial<ShrinkDeps> = {}): Promise<ShrinkResult> {
  const complete = ["now", "candidates", "repliedThreads", "heldThreads", "writtenTo", "open", "seal", "sealing", "apply", "cursor"].every((k) => k in deps);
  const d: ShrinkDeps = complete ? (deps as ShrinkDeps) : { ...(await realDeps()), ...deps };
  const result: ShrinkResult = { shrunk: 0, skipped: 0, keyErrors: 0, bytesBefore: 0, bytesAfter: 0 };
  const cutoff = new Date(d.now() - SHRINK_AFTER_DAYS * DAY_MS).toISOString();
  const rows = await d.candidates(cutoff, d.cursor.after, limit * 2);
  if (!rows.length) {
    d.cursor.after = null;
    return result;
  }
  const ids = [...new Set(rows.map((r) => r.thread_id))];
  const [replied, held] = await Promise.all([d.repliedThreads(ids), d.heldThreads(ids)]);
  const written = new Map<string, boolean>();
  const wasWritten = async (userId: string, idx: string) => {
    const key = `${userId}:${idx}`;
    if (!written.has(key)) written.set(key, await d.writtenTo(userId, idx));
    return written.get(key)!;
  };

  let last = d.cursor.after;
  for (const row of rows) {
    if (result.shrunk >= limit) break;
    last = row.sent_at;
    if (replied.has(row.thread_id) || held.has(row.thread_id) || (row.sender_index && (await wasWritten(row.user_id, row.sender_index)))) {
      result.skipped++;
      continue;
    }
    try {
      const text = row.body_text;
      let next: string | null = null;
      if (text != null) {
        const encrypted = isCiphertext(text);
        const plain = encrypted ? await d.open(row.user_id, text) : text;
        // Never turn a sealed value into plain text, and never store a preview of something that could not be opened.
        if (plain == null) throw new Error("could not open");
        if (encrypted && !d.sealing()) throw new Error("sealing is off");
        const cut = previewOf(plain);
        next = encrypted ? await d.seal(row.user_id, cut) : cut;
        if (encrypted && (next == null || !isCiphertext(next))) throw new Error("could not seal");
      }
      if (await d.apply(row.id, { body_text: next, body_marks: null, body_shrunk_at: new Date(d.now()).toISOString() })) {
        result.shrunk++;
        result.bytesBefore += (text?.length ?? 0) + (row.body_marks?.length ?? 0);
        result.bytesAfter += next?.length ?? 0;
      }
    } catch (err) {
      result.keyErrors++;
      result.skipped++;
      log.warn("could not shorten bulk mail", { code: errorCode(err) });
    }
  }
  // A short page means the end of the queue: start again from the oldest next time.
  d.cursor.after = rows.length < limit * 2 ? null : last;
  if (result.shrunk || result.keyErrors) log.info("shortened old bulk mail", { shrunk: result.shrunk, skipped: result.skipped, key_errors: result.keyErrors });
  return result;
}
