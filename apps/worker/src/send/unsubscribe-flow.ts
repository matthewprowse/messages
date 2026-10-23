import type { Tables } from "@messages/db";
import { allRows, db, must } from "../db";
import { errorCode, log } from "../log";
import { chunks } from "../util";
import { bodyUnsubscribeLink, oneClickUnsubscribe, parseListUnsubscribe } from "./unsubscribe";
import { FIELD } from "@messages/crypto/fields";
import { addressIndex } from "@messages/crypto/addresses";
import { keysFor, open } from "../vault";

export type MailtoUnsubscribe = { to: string; subject: string; body: string };

/**
 * Unsubscribes from one sender with their List-Unsubscribe header: one-click where offered, else an
 * unsubscribe email (sent by the account's own connector), else a page you open yourself: the header's
 * link, or for senders with no header, the unsubscribe link in their latest email. Their
 * conversations are then marked as junk.
 */
export async function carryOutUnsubscribe(
  accountId: string,
  row: Tables<"unsubscribes">,
  sendMailto: (mailto: MailtoUnsubscribe) => Promise<void>,
) {
  const claimed = must(
    await db.from("unsubscribes").update({ status: "working" }).eq("id", row.id).eq("status", "queued").select("id"),
    "claim unsubscribe",
  );
  if (claimed.length === 0) return;
  const finish = (patch: Partial<Tables<"unsubscribes">>) =>
    db.from("unsubscribes").update({ ...patch, done_at: new Date().toISOString() }).eq("id", row.id);

  const viaEmail = async (mailto: MailtoUnsubscribe): Promise<Partial<Tables<"unsubscribes">>> => {
    try {
      await sendMailto(mailto);
      return { status: "done", method: "mailto" };
    } catch {
      return { status: "failed", method: "mailto", error: "The unsubscribe email could not be sent." };
    }
  };

  // Their mail is found by the sender's index: the database matches on that, not the address.
  const senderIndex = row.sender_index ?? (await addressIndex(await keysFor(row.user_id), (await open(row.user_id, FIELD.address, row.sender_address)) ?? ""));
  let outcome: Partial<Tables<"unsubscribes">>;
  try {
    const latest = must(
      await db
        .from("messages")
        .select("list_unsubscribe, list_unsubscribe_post")
        .eq("account_id", accountId)
        .eq("sender_index", senderIndex)
        .not("list_unsubscribe", "is", null)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "load unsubscribe header",
    );
    const options = parseListUnsubscribe(await open(row.user_id, FIELD.unsubscribe, latest?.list_unsubscribe));

    if (options.https && latest?.list_unsubscribe_post) {
      const result = await oneClickUnsubscribe(options.https).catch(() => ({ ok: false }));
      outcome = result.ok
        ? { status: "done", method: "one_click" }
        : options.mailto
          ? await viaEmail(options.mailto)
          : { status: "manual", method: "link", manual_url: options.https, error: "The sender did not confirm. Open their page to finish." };
    } else if (options.mailto) {
      outcome = await viaEmail(options.mailto);
    } else if (options.https) {
      outcome = { status: "manual", method: "link", manual_url: options.https, error: "This sender needs you to confirm on their page." };
    } else {
      // No header: offer the link from their latest email, for you to open yourself.
      const newest = must(
        await db
          .from("messages")
          .select("body_text")
          .eq("account_id", accountId)
          .eq("sender_index", senderIndex)
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "load latest email",
      );
      const link = bodyUnsubscribeLink(await open(row.user_id, FIELD.body, newest?.body_text));
      outcome = link
        ? { status: "manual", method: "link", manual_url: link, error: "This sender needs you to unsubscribe on their page." }
        : { status: "failed", error: "This sender does not offer a way to unsubscribe." };
    }
    must(await finish(outcome), "finish unsubscribe");
    log.info("unsubscribe finished", { account: accountId, status: outcome.status, method: outcome.method ?? null });
  } catch (err) {
    log.warn("unsubscribe failed", { account: accountId, code: errorCode(err) });
    await finish({ status: "failed", error: "Something went wrong. Try again." });
    return;
  }

  // Their mail belongs in Junk from now on, whichever way it went. The row is already finished, so a
  // failure here is only logged: marking it failed would invite a second unsubscribe email.
  try {
    await markSenderJunk(accountId, senderIndex);
  } catch (err) {
    log.warn("unsubscribe junk failed", { account: accountId, code: errorCode(err) });
  }
}

const CHUNK = 200; // thread ids per update, to keep the request URL short

/** Marks every conversation with mail from this sender (by their index) as junk. */
async function markSenderJunk(accountId: string, senderIndex: string) {
  const rows = await allRows(
    (from, to) => db.from("messages").select("id, thread_id").eq("account_id", accountId).eq("sender_index", senderIndex).order("id").range(from, to),
    "load sender threads",
  );
  for (const ids of chunks([...new Set(rows.map((r) => r.thread_id))], CHUNK)) {
    must(await db.from("threads").update({ junk: true }).in("id", ids), "mark sender junk");
  }
}
