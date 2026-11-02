// Loads every contact with their identities, and the Contacts list built from the store's contacts.

import { openAddresses } from "../open-rows";
import { supabase } from "../supabase";
import type { Contact } from "../types";
import { allRows, type ContactSummary } from "../contacts";
import { summariseStored, type Activity } from "../contact-summaries";
import { CONTACT_COLUMNS, type IdentityRow } from "./columns";
import { mapContact } from "./map-contact";

/** Every contact with their addresses and numbers. Throws when a page fails. */
export async function loadContacts(): Promise<Contact[]> {
  const [contacts, identities] = await Promise.all([
    allRows("Load contacts", (from, to) => supabase.from("contacts").select(CONTACT_COLUMNS).order("id").range(from, to)),
    allRows("Load contacts", (from, to) => supabase.from("contact_identities").select("id, contact_id, kind, value").order("id").range(from, to)),
  ]);
  await openAddresses(identities);
  const identitiesOf = new Map<string, IdentityRow[]>();
  for (const i of identities) {
    const list = identitiesOf.get(i.contact_id);
    if (list) list.push(i);
    else identitiesOf.set(i.contact_id, [i]);
  }
  return contacts.map((c) => mapContact(c, identitiesOf.get(c.id) ?? []));
}

/** The Contacts list from the store's contacts, or null when the store is missing someone. Throws when a read fails. */
export async function listContactsFromStore(stored: Contact[]): Promise<ContactSummary[] | null> {
  const [rows, activity, whatsapp] = await Promise.all([
    allRows("Load contacts", (from, to) => supabase.from("contacts").select("id, hidden").order("id").range(from, to)),
    allRows("Load contact summaries", (from, to) => supabase.rpc("contact_summaries").order("contact_id").range(from, to)),
    allRows("Load contacts", (from, to) => supabase.from("contact_identities").select("id, contact_id, kind").in("kind", ["whatsapp", "linkedin"]).order("id").range(from, to)),
  ]);
  return summariseStored(
    rows,
    new Map(stored.map((c) => [c.id, c])),
    new Map(activity.map((a) => [a.contact_id, a as Activity])),
    new Set(whatsapp.filter((w) => w.kind === "whatsapp").map((w) => w.contact_id)),
    new Set(whatsapp.filter((w) => w.kind === "linkedin").map((w) => w.contact_id)),
  );
}
