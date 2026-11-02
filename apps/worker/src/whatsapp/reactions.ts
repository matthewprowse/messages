// Reactions a WhatsApp message arrived with, in the form provider_meta keeps them. SELF is who you are in
// provider_meta.reactions; everyone else is the index of their number or privacy ID.

import { jidNormalizedUser, type proto } from "baileys";
import { addressIndex } from "@messages/crypto/addresses";
import { keysFor, sealAddress } from "../vault";
import { e164 } from "./normalize";

export const SELF = "me";

/**
 * Reactions a message arrived with, as provider_meta keeps them: reactions by who reacted, which is "me"
 * or the index of their number or privacy ID, and reactors, who each index is, encrypted.
 */
export async function historyReactions(userId: string, list: proto.IReaction[]): Promise<{ reactions: Record<string, string>; reactors: Record<string, string> }> {
  const reactions: Record<string, string> = {};
  const reactors: Record<string, string> = {};
  for (const r of list) {
    if (!r.text) continue;
    if (r.key?.fromMe) {
      reactions[SELF] = r.text;
      continue;
    }
    const who = e164(r.key?.participant ?? r.key?.remoteJid) ?? jidNormalizedUser(r.key?.participant ?? r.key?.remoteJid ?? "");
    if (!who) continue;
    const key = await addressIndex(await keysFor(userId), who);
    reactions[key] = r.text;
    reactors[key] = await sealAddress(userId, who);
  }
  return { reactions, reactors };
}
