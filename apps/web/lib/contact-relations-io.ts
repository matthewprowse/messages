// Reading and writing the relationship layer: who is starred and what each relationship is, the last message each way,
// and the star and About note. The About note is sealed in the browser (FIELD.contactAbout); nothing here sends a message.

import { FIELD } from "@messages/crypto/fields";
import { allRows } from "./contacts";
import { joinRelations, type Relation } from "./contact-relations";
import { openAddresses } from "./open-rows";
import { supabase } from "./supabase";
import { seal } from "./vault";

/** Longest About note the form takes (the column holds a sealed copy up to 4000 characters). */
export const MAX_ABOUT = 1000;

/** The star, relationship and last message each way for every contact that has any. Throws when a read fails. */
export async function loadRelations(): Promise<Map<string, Relation>> {
  const [flags, touches] = await Promise.all([
    allRows("Load relationships", (from, to) => supabase.from("contacts").select("id, vip, relationship").or("vip.eq.true,relationship.not.is.null").order("id").range(from, to)),
    allRows("Load last contact", (from, to) => supabase.rpc("contact_last_touch").order("contact_id").range(from, to)),
  ]);
  await openAddresses(flags);
  return joinRelations(flags, touches);
}

/** Stars or unstars a contact. */
export async function setContactVip(id: string, vip: boolean): Promise<boolean> {
  const { error } = await supabase.from("contacts").update({ vip }).eq("id", id);
  return !error;
}

/** Saves the note about a person, sealed; empty clears it. */
export async function setContactAbout(id: string, text: string): Promise<boolean> {
  const value = text.trim();
  try {
    const { error } = await supabase.from("contacts").update({ about_note: value ? await seal(FIELD.contactAbout, value) : null }).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}
