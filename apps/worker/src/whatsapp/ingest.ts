import type { Json } from "@messages/db";
import { db, must } from "../db";
import { BatchRpc, type RpcResponse } from "../ingest/batch-rpc";

/** History messages per bulk call: they are small, so more than for email. */
export const HISTORY_PER_CALL = 50;

/** What public.ingest_whatsapp returns for one message. */
export type WhatsAppStored = { result: "inserted" | "updated"; message_id?: string; thread_id?: string; attachment_ids?: string[] };

/** Stores one WhatsApp message exactly once (public.ingest_whatsapp). Live messages go this way. */
export async function ingestWhatsApp(accountId: string, payload: Json): Promise<WhatsAppStored> {
  return must(await db.rpc("ingest_whatsapp", { p_account_id: accountId, p_msg: payload }), "ingest whatsapp") as WhatsAppStored;
}

/**
 * Stores history from the phone a chunk per database call (public.ingest_whatsapp_batch), in order, with
 * one result per message in the same order. One that could not be stored comes back as a RowFailure.
 */
export const ingestWhatsAppHistory = new BatchRpc<Json, WhatsAppStored>(
  "ingest_whatsapp_batch",
  HISTORY_PER_CALL,
  // Not in the generated database types until the migration is applied and they are regenerated.
  (accountId, msgs) => (db.rpc.bind(db) as unknown as (fn: string, args: object) => PromiseLike<RpcResponse>)("ingest_whatsapp_batch", { p_account_id: accountId, p_msgs: msgs }),
  ingestWhatsApp,
);
