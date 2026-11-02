// Export and import of contacts, the parts that touch the database. Export reads every contact and opens the encrypted
// fields in the browser; import applies a plan from contact-import.ts through the same functions New Contact and Edit
// Contact use, so every limit and every duplicate check still applies. Nothing is sent to anyone.

import { allRows, createContact, identities, updateContact } from "./contacts";
import type { ExportContact } from "./contact-export";
import type { ImportItem, ImportRow } from "./contact-import";
import { setContactAbout, setContactVip } from "./contact-relations-io";
import { canonicalRelationship, MAX_RELATIONSHIP } from "./relationships";
import { openAddresses } from "./open-rows";
import { supabase } from "./supabase";

/** Every contact, opened, as the export files hold them. Throws when a read fails. */
export async function loadExportContacts(): Promise<ExportContact[]> {
  const rows = await allRows("Load contacts", (from, to) =>
    supabase.from("contacts").select("id, display_name, company, role, relationship, about_note, vip, contact_identities(kind, value)").order("id").range(from, to),
  );
  await openAddresses(rows);
  return rows
    .map((c) => {
      const ids = identities(c.contact_identities);
      return {
        name: c.display_name,
        emails: ids.emails,
        phones: ids.phones,
        company: c.company ?? "",
        role: c.role ?? "",
        relationship: c.relationship ?? "",
        about: c.about_note ?? "",
        vip: c.vip,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en-ZA", { sensitivity: "base" }));
}

export interface ImportResult {
  created: number;
  merged: number;
  /** One short sentence per row that could not be saved, with the name it was for. */
  failed: string[];
}

const clip = (text: string, max: number) => text.trim().slice(0, max);

/** The fields the row can fill on a person: only those that are empty, never over what they have. */
function fills(row: ImportRow, have: { company: string; role: string; relationship: string }) {
  return {
    company: have.company || clip(row.company, 120),
    role: have.role || clip(row.role, 120),
    relationship: have.relationship || clip(canonicalRelationship(row.relationship), MAX_RELATIONSHIP),
  };
}

async function addPerson(item: ImportItem): Promise<string | null> {
  const row = item.row;
  const made = await createContact({
    name: clip(item.name, 120),
    emails: item.emails,
    phones: item.phones,
    company: clip(row.company, 120),
    role: clip(row.role, 120),
    relationship: clip(canonicalRelationship(row.relationship), MAX_RELATIONSHIP),
  });
  if (!made.ok) return made.error;
  if (row.about.trim()) await setContactAbout(made.id, row.about.slice(0, 1000));
  if (row.vip) await setContactVip(made.id, true);
  return null;
}

async function mergePerson(item: ImportItem): Promise<string | null> {
  const target = item.target;
  if (!target) return "No one to add this to.";
  const { data, error } = await supabase.from("contacts").select("company, role, relationship, about_note, vip").eq("id", target.id).maybeSingle();
  if (error || !data) return "Could not read the contact to add to.";
  await openAddresses([data]);
  const have = { company: data.company ?? "", role: data.role ?? "", relationship: data.relationship ?? "" };
  const next = fills(item.row, have);
  const changed = item.emails.length > 0 || item.phones.length > 0 || next.company !== have.company || next.role !== have.role || next.relationship !== have.relationship;
  if (changed) {
    const saved = await updateContact(target.id, { name: target.name, ...next, addEmails: item.emails, addPhones: item.phones, remove: [] });
    if (!saved.ok) return saved.error;
  }
  if (item.row.about.trim() && !data.about_note?.trim()) await setContactAbout(target.id, item.row.about.slice(0, 1000));
  if (item.row.vip && !data.vip) await setContactVip(target.id, true);
  return null;
}

/** Applies a plan one row at a time, so one failure does not stop the rest. onProgress gets the rows done so far. */
export async function applyImport(plan: ImportItem[], onProgress?: (done: number) => void): Promise<ImportResult> {
  const result: ImportResult = { created: 0, merged: 0, failed: [] };
  let done = 0;
  for (const item of plan) {
    if (item.action !== "skip") {
      const problem = item.action === "create" ? await addPerson(item) : await mergePerson(item);
      if (problem) result.failed.push(`${item.name}: ${problem}`);
      else if (item.action === "create") result.created++;
      else result.merged++;
    }
    onProgress?.(++done);
  }
  return result;
}
