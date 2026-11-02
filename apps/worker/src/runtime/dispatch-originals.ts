// View Original requests and files fetched again from the mailbox, plus the hourly expiry of fetched originals. The
// email's HTML is only ever held on the request row, encrypted for the person who asked, and deleted after an hour.

import { FIELD } from "@messages/crypto/fields";
import type { Tables } from "@messages/db";
import { db, must } from "../db";
import { fetchRequestedAttachments } from "../ingest/fetch-requests";
import { errorCode, log } from "../log";
import { isPrimaryShard, ownsAccount } from "../shard";
import { seal } from "../vault";
import { dispatchOnce, running } from "./state";

// A View Original request is answered within seconds; a fetched original is deleted after an hour. A failed request
// stores only a code (not_found, gone, no_layout, unreachable), never text from the provider; the app words it.
const ORIGINAL_KEEP_MS = 60 * 60 * 1000;

export type OriginalRequest = Tables<"email_originals">;

async function finishOriginal(id: string, patch: Partial<OriginalRequest>) {
  must(await db.from("email_originals").update(patch).eq("id", id), "save original");
}

/**
 * View Original: the email fetched from Gmail, Outlook or iCloud, its HTML encrypted for the person who asked.
 * The HTML is never stored with the message, only on the request, which is deleted after an hour.
 */
export async function dispatchOriginals(rows?: OriginalRequest[]) {
  const list = rows ?? must(await db.from("email_originals").select("*").eq("status", "queued").order("created_at").limit(20), "load original requests");
  for (const row of list) {
    if (row.status !== "queued") continue;
    await dispatchOnce(
      row.id,
      async () => {
        const message = must(await db.from("messages").select("account_id, user_id, provider_meta").eq("id", row.message_id).maybeSingle(), "load original's email");
        if (!message && !isPrimaryShard) return null; // nobody owns a request for a missing email: shard 0 settles it
        if (message && !ownsAccount(message.account_id)) return null; // another shard's account
        if (!message || message.user_id !== row.user_id) return () => finishOriginal(row.id, { status: "failed", error: "not_found" });
        const connector = running.get(message.account_id)?.connector;
        if (!connector?.original) return null; // still connecting: the next poll picks it up
        const fetchOriginal = connector.original.bind(connector);
        return async () => {
          await finishOriginal(row.id, { status: "working" });
          try {
            const html = await fetchOriginal(message.provider_meta);
            if (html === "missing") await finishOriginal(row.id, { status: "failed", error: "gone" });
            else if (html === null) await finishOriginal(row.id, { status: "failed", error: "no_layout" });
            else await finishOriginal(row.id, { status: "done", html: await seal(row.user_id, FIELD.html, html) });
          } catch (err) {
            log.warn("original fetch failed", { code: errorCode(err) });
            await finishOriginal(row.id, { status: "failed", error: "unreachable" });
          }
        };
      },
      (err) => log.error("original failed", { code: errorCode(err) }),
    );
  }
}


/** Removes fetched originals after ORIGINAL_KEEP_MS, so an email's HTML is only ever held briefly. */
export async function expireOriginals() {
  must(await db.from("email_originals").delete().lt("created_at", new Date(Date.now() - ORIGINAL_KEEP_MS).toISOString()), "expire originals");
}

/**
 * Files the app asked for because they were not copied at once (old or large email attachments): each is fetched again
 * from the mailbox that holds it. Only the shard that runs that mailbox takes a request.
 */
export function fetchAttachmentRequests() {
  return fetchRequestedAttachments(5, {
    owns: ownsAccount,
    sourceFor: (accountId) => {
      const connector = running.get(accountId)?.connector;
      return connector?.attachmentsOf ? { attachmentsOf: (meta) => connector.attachmentsOf!(meta) } : undefined;
    },
  }).then(() => undefined);
}
