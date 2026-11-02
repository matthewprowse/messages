// Companies as the Contacts page needs them. The database files every contact under the organization for
// its email domain (personal mail providers and your own domains are left out), so a company is the people
// who write from that domain. Reads go through the signed-in browser client, so row-level security limits
// them to the user's own rows.

import { supabase } from "./supabase";
import { openAddresses, openNestedThreads, openOrganizations } from "./open-rows";
import { allRows, identities, isUuid } from "./contacts";
import type { Provider } from "./types";

export interface CompanySummary {
  id: string;
  name: string;
  domain: string;
  summary: string | null;
  /** The company's shared logo in the "logos" bucket; none shows a building icon. */
  logoPath?: string;
  people: number;
  addresses: number;
  conversations: number;
  /** Latest message in any conversation with its people, or null if there is none yet. */
  lastAt: string | null;
}

export interface CompanyPerson {
  id: string;
  name: string;
  role: string | null;
  emails: string[];
  phones: string[];
  avatarPath?: string;
}

export interface CompanyConversation {
  id: string;
  channel: "email" | "whatsapp";
  /** The service it comes from, for its logo. */
  provider?: Provider;
  /** The company's person in the conversation, or the group name for a group. */
  title: string;
  /** The subject for email, the latest message for chats. */
  preview: string;
  lastAt: string | null;
}

export interface CompanyDetail extends Omit<CompanySummary, "people" | "addresses" | "conversations"> {
  people: CompanyPerson[];
  conversations: CompanyConversation[];
}

/** The Companies list. The counts are made in the database (company_summaries), so no contact, address or conversation is loaded. */
export async function listCompanies(): Promise<CompanySummary[]> {
  const rows = await openOrganizations(await openAddresses(await allRows("Load companies", (from, to) => supabase.rpc("company_summaries").order("id").range(from, to))));
  return rows.map((o) => ({
    id: o.id,
    name: o.name,
    domain: o.domain,
    summary: o.summary,
    logoPath: o.logo_path ?? undefined,
    people: o.people,
    addresses: o.addresses,
    conversations: o.conversations,
    lastAt: o.last_at ?? null,
  }));
}

const pick = ({ emails, phones }: { emails: string[]; phones: string[] }) => ({ emails, phones });

export async function getCompany(id: string): Promise<CompanyDetail | null> {
  if (!isUuid(id)) return null;
  const { data: o, error } = await supabase
    .from("organizations")
    .select(
      "id, name, domain, summary, logo_path, contacts(id, display_name, role, avatar_path, contact_identities(kind, value), thread_participants(threads(id, channel, subject, group_name, is_group, status, last_message_preview, last_message_at, accounts(provider))))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Load company failed (${error.code})`);
  if (!o) return null;
  await Promise.all([openNestedThreads(o.contacts), openAddresses(o), openOrganizations([o])]);

  const people = o.contacts
    .map((c) => ({ id: c.id, name: c.display_name, role: c.role, ...pick(identities(c.contact_identities)), avatarPath: c.avatar_path ?? undefined }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // A conversation with two of its people is listed once, under the first of them.
  const conversations = new Map<string, CompanyConversation>();
  for (const c of o.contacts) {
    for (const p of c.thread_participants) {
      const t = p.threads;
      // A group is not the company's: someone from it being in the group does not file the group under it.
      if (!t || t.status === "trash" || t.is_group || conversations.has(t.id)) continue;
      conversations.set(t.id, {
        id: t.id,
        channel: t.channel as CompanyConversation["channel"],
        provider: (t.accounts?.provider ?? undefined) as Provider | undefined,
        title: (t.is_group ? t.group_name : c.display_name) ?? c.display_name,
        preview: (t.channel === "email" ? t.subject : null) ?? t.last_message_preview ?? (t.channel === "email" ? "No Subject" : ""),
        lastAt: t.last_message_at,
      });
    }
  }
  const sorted = [...conversations.values()].sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  return { id: o.id, name: o.name, domain: o.domain, summary: o.summary, logoPath: o.logo_path ?? undefined, people, conversations: sorted, lastAt: sorted[0]?.lastAt ?? null };
}

/** Row-level security lets you change only the name. */
export async function renameCompany(id: string, name: string): Promise<void> {
  const { data, error } = await supabase.from("organizations").update({ name }).eq("id", id).select("id");
  if (error) throw new Error(`Rename company failed (${error.code})`);
  if (data.length === 0) throw new Error("Rename company failed (no row)");
}
