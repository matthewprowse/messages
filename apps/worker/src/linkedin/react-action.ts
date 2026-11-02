// The database side of a LinkedIn reaction (see reactions.ts): finding the message and thread it is for, keeping
// your reaction on the message once LinkedIn has it, and settling the action.

import type { Tables } from "@messages/db";
import { db, must } from "../db";
import { finishAction } from "../send/actions";
import { openAddresses } from "../vault";
import { SELF, applyReaction, type ReactHelper, type ReactIo } from "./reactions";

export const reactIo: ReactIo = {
  async target(row, accountId) {
    if (!row.message_id) return null;
    const found = must(
      await db.from("messages").select("provider_message_id, thread_id, threads(provider_thread_id)").eq("id", row.message_id).eq("account_id", accountId).maybeSingle(),
      "load linkedin reaction target",
    );
    if (!found) return null;
    await openAddresses(row.user_id, found);
    return { conversation: found.threads?.provider_thread_id ?? null, message: found.provider_message_id, threadId: found.thread_id };
  },
  async record(accountId, message, emoji) {
    must(await db.rpc("whatsapp_react", { p_account_id: accountId, p_provider_message_id: message, p_sender: SELF, p_emoji: emoji }), "save my reaction");
  },
  finish: finishAction,
};

/** Sends a 'react' action over the helper. Returns the error when the session should hear of it, else undefined. */
export const sendReaction = (accountId: string, helper: ReactHelper, row: Tables<"mail_actions">) => applyReaction(accountId, helper, row, reactIo);
