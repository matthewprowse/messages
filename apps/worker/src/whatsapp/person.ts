// Shapes the WhatsApp connector passes around (a person, the provider_meta kept per message, a message ready to store)
// and the JSON form of a person that public.whatsapp_contact takes. Used by connectors/whatsapp.ts and its helpers.

import type { Json } from "@messages/db";
import { addressIndex } from "@messages/crypto/addresses";
import type { UserKeys } from "@messages/crypto";
import { sealAddress, sealName } from "../vault";
import type { NameRank } from "../contacts/name-rank";
import type { StoredMedia } from "./media";
import type { WhatsAppStored } from "./ingest";

/** The account a helper works for: its id, and the user whose keys seal and open its rows. */
export interface AccountCtx {
  accountId: string;
  userId: string;
}

/** A WhatsApp person: phone number in E.164 and privacy ID, whichever are known, and the best name. */
export interface Person {
  phone: string | null;
  lid: string | null;
  /** Preferred JID: the phone number's, else the privacy ID's. */
  jid: string;
  display_name: string;
  /** What kind of name display_name is (contacts.display_name_rank): saved, set by the person, or their number. */
  name_rank: NameRank;
  push_name: string | null;
}

/** What provider_meta keeps for a message, as far as the connector reads it back. */
export interface StoredMeta {
  chat: string;
  from_me: boolean;
  participant: string | null;
  media?: StoredMedia;
  receipt?: string;
}

/** A message ready to store, and what to do once it is stored (returns true when it was new). */
export interface Prepared {
  payload: Json;
  finish: (stored: WhatsAppStored) => boolean;
}

/**
 * A person as public.whatsapp_contact takes them: their number and privacy ID as stored (encrypted once
 * addresses are), with the indexes it matches them on, and their names sealed with the rank it decides by.
 */
export async function personJson(keys: UserKeys, p: Pick<Person, "phone" | "lid" | "display_name" | "name_rank" | "push_name">, userId: string) {
  return {
    phone: await sealAddress(userId, p.phone),
    lid: await sealAddress(userId, p.lid),
    phone_index: p.phone ? await addressIndex(keys, p.phone) : null,
    lid_index: p.lid ? await addressIndex(keys, p.lid) : null,
    // Trimmed here: the database trimmed readable names, and cannot trim sealed ones.
    display_name: await sealName(userId, p.display_name.trim() || null, { place: "contacts.display_name" }),
    name_rank: p.name_rank,
    push_name: await sealName(userId, p.push_name?.trim() || null, { place: "contacts.display_name" }),
  };
}
