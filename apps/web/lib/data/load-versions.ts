// Reads what a WhatsApp message said before it was edited or deleted (message_versions) and opens it. View Original asks for this
// when it is clicked, so nothing is loaded for messages nobody inspects.

import { FIELD } from "@messages/crypto/fields";
import { supabase } from "../supabase";
import { open } from "../vault";
import type { MessageVersion } from "../message-versions";

/** A message's kept versions, oldest first. Throws when they cannot be read. */
export async function loadVersions(messageId: string): Promise<MessageVersion[]> {
  const { data, error } = await supabase.from("message_versions").select("reason, body_text, created_at").eq("message_id", messageId).order("created_at");
  if (error) throw error;
  const opened = await Promise.all((data ?? []).map(async (r) => ({ reason: r.reason as MessageVersion["reason"], text: await open(FIELD.body, r.body_text), at: r.created_at })));
  return opened.flatMap((v) => (v.text === null ? [] : [{ ...v, text: v.text }]));
}
