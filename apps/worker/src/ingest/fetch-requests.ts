// Fetches an email attachment on request. Files over the eager size or on old messages are not copied when the mail
// arrives (storage-rules.ts isDeferred, attachments.not_kept = 'deferred'); when the owner opens one, the web app
// inserts a row in attachment_fetch_requests and this module fetches that one message's file from the provider
// through the connector that already syncs the account, keeps it through file-store.ts (sealing, thumbnail, cap),
// and deletes the request. A file the provider no longer has is marked not_kept = 'unavailable'. Failures leave the
// request with an error the viewer shows; the owner may delete a failed request to try again.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@messages/db";
import { db } from "../db";
import { MAX_FILE_BYTES } from "../file-store";
import { errorCode, log } from "../log";
import { saveAttachmentFiles } from "./attachment-files";
import type { EmailAttachment } from "./normalize-email";

/** A claim older than this with no result is taken to belong to a worker that stopped, and is claimed again. */
export const CLAIM_STALE_MS = 10 * 60 * 1000;

/** What a failed request tells the viewer. */
export const FETCH_MESSAGES = {
  gone: "This File Is No Longer in Your Mailbox.",
  tooLarge: "This File Is Too Large to Copy. Open It in Your Mailbox.",
  full: "Your Storage Is Full, so This File Could Not Be Copied. Open It in Your Mailbox.",
  offline: "This Mailbox Is Not Connected Right Now. Try Again Later.",
  failed: "The File Could Not Be Fetched. Try Again Later.",
} as const;

export interface RequestRow {
  attachment_id: string;
  user_id: string;
}

export interface Target {
  id: string;
  user_id: string;
  message_id: string;
  size_bytes: number;
  storage_path: string | null;
  account_id: string;
  provider_meta: Json;
}

/** The part of a running mail connector this needs: Gmail, Outlook and IMAP/iCloud all have it. */
export interface AttachmentSource {
  attachmentsOf(meta: Json): Promise<EmailAttachment[] | null>;
}

export type KeepOutcome = "saved" | "over_cap" | "no_match";

/** What fetchRequestedAttachments needs from the outside; replaced in tests. */
export interface FetchDeps {
  /** Takes up to `limit` unclaimed (or stale) requests without an error, oldest first. */
  claim(limit: number): Promise<RequestRow[]>;
  target(attachmentId: string): Promise<Target | null>;
  /** The running connector of an account, or undefined when it is not running. */
  sourceFor(accountId: string): AttachmentSource | undefined;
  keep(target: Target, files: EmailAttachment[]): Promise<KeepOutcome>;
  /** False for an account another worker shard runs: the request is handed back unclaimed for that shard. Left out, every account is ours. */
  owns?(accountId: string): boolean;
  /** Hands a claimed request back, so the shard that owns the account can take it. */
  release(attachmentId: string): Promise<void>;
  /** The request is done. */
  finish(attachmentId: string): Promise<void>;
  /** The request failed: the viewer shows `message`. `unavailable` also marks the attachment as gone from the mailbox. */
  fail(attachmentId: string, message: string, unavailable: boolean): Promise<void>;
}

// attachment_fetch_requests is not in the generated types until they are regenerated after its migration.
const loose = () => db as unknown as SupabaseClient;

const liveDeps: FetchDeps = {
  async claim(limit) {
    const stale = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
    const open = `claimed_at.is.null,claimed_at.lt.${stale}`;
    const { data, error } = await loose().from("attachment_fetch_requests").select("attachment_id, user_id").is("error", null).or(open).order("created_at").limit(limit);
    if (error) {
      // The table missing (migration not applied yet) is not worth a log line every poll.
      if ((error as { code?: string }).code === "42P01" || (error as { code?: string }).code === "PGRST205") return [];
      throw Object.assign(new Error("load fetch requests failed"), { code: "FETCH_REQ_LOAD" });
    }
    const claimed: RequestRow[] = [];
    for (const row of (data ?? []) as RequestRow[]) {
      // Whoever updates the row first owns it: the others find it no longer matches.
      const won = await loose().from("attachment_fetch_requests").update({ claimed_at: new Date().toISOString() }).eq("attachment_id", row.attachment_id).is("error", null).or(open).select("attachment_id");
      if (!won.error && won.data && won.data.length > 0) claimed.push(row);
    }
    return claimed;
  },
  async target(attachmentId) {
    const { data, error } = await db
      .from("attachments")
      .select("id, user_id, message_id, size_bytes, storage_path, messages!inner(account_id, provider_meta)")
      .eq("id", attachmentId)
      .maybeSingle();
    if (error) throw Object.assign(new Error("load attachment failed"), { code: "FETCH_REQ_TARGET" });
    if (!data) return null;
    return { id: data.id, user_id: data.user_id, message_id: data.message_id, size_bytes: data.size_bytes ?? 0, storage_path: data.storage_path, account_id: data.messages.account_id, provider_meta: data.messages.provider_meta };
  },
  sourceFor: () => undefined,
  async keep(target, files) {
    await saveAttachmentFiles(target.account_id, target.user_id, target.message_id, files, { wanted: new Set([target.id]) });
    const { data } = await db.from("attachments").select("storage_path, not_kept").eq("id", target.id).maybeSingle();
    if (data?.storage_path) return "saved";
    return data?.not_kept === "over_cap" ? "over_cap" : "no_match";
  },
  async release(attachmentId) {
    await loose().from("attachment_fetch_requests").update({ claimed_at: null }).eq("attachment_id", attachmentId).is("error", null);
  },
  async finish(attachmentId) {
    const { error } = await loose().from("attachment_fetch_requests").delete().eq("attachment_id", attachmentId);
    if (error) throw Object.assign(new Error("finish fetch request failed"), { code: "FETCH_REQ_FINISH" });
  },
  async fail(attachmentId, message, unavailable) {
    if (unavailable) await db.from("attachments").update({ not_kept: "unavailable" }).eq("id", attachmentId).is("storage_path", null);
    await loose().from("attachment_fetch_requests").update({ error: message }).eq("attachment_id", attachmentId);
  },
};

/**
 * Fetches up to `limit` requested attachments, one at a time. Returns how many were saved. A request for a file that
 * is already stored, or that is not the requester's, is dropped. Errors are recorded on the request; only a failure
 * to reach the database throws.
 */
export async function fetchRequestedAttachments(limit: number, deps: Partial<FetchDeps> = {}): Promise<number> {
  const d: FetchDeps = { ...liveDeps, ...deps };
  const requests = await d.claim(limit);
  let saved = 0;
  for (const req of requests) {
    try {
      const target = await d.target(req.attachment_id);
      if (!target || target.user_id !== req.user_id || target.storage_path) {
        await d.finish(req.attachment_id);
        continue;
      }
      if (d.owns && !d.owns(target.account_id)) {
        await d.release(req.attachment_id);
        continue;
      }
      if (target.size_bytes > MAX_FILE_BYTES) {
        await d.fail(req.attachment_id, FETCH_MESSAGES.tooLarge, false);
        continue;
      }
      const source = d.sourceFor(target.account_id);
      if (!source) {
        await d.fail(req.attachment_id, FETCH_MESSAGES.offline, false);
        continue;
      }
      const files = await source.attachmentsOf(target.provider_meta);
      const outcome = files ? await d.keep(target, files) : "no_match";
      if (outcome === "saved") {
        await d.finish(req.attachment_id);
        saved++;
      } else if (outcome === "over_cap") {
        await d.fail(req.attachment_id, FETCH_MESSAGES.full, false);
      } else {
        await d.fail(req.attachment_id, FETCH_MESSAGES.gone, true);
      }
    } catch (err) {
      log.warn("attachment fetch request failed", { attachment: req.attachment_id, code: errorCode(err) });
      await d.fail(req.attachment_id, FETCH_MESSAGES.failed, false).catch(() => undefined);
    }
  }
  return saved;
}
