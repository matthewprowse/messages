// One contact's page (/contacts/[id]): the contact, their conversations, the last message each way and their files,
// read in two round trips. Reads go through the signed-in browser client, so row-level security limits them to the
// user's own rows. The list and the contact forms are in contacts.ts.

import { allRows, asKind, identities, isUuid, type ContactConversation, type ContactDetail } from "./contacts";
import { openAddresses, openNestedThreads } from "./open-rows";
import { supabase } from "./supabase";
import { formatSize } from "./format";
import type { Attachment, FiledAttachment, Provider } from "./types";
import { companyLogo, isCompanySender, logoAvatar } from "./people";
import { withSealedColumns } from "./sealed-columns";

/**
 * One contact's page, or null when there is no such contact. Two round trips, not four: the contact, their
 * conversations and the last message each way are read together (each needs only the id), then the conversation titles
 * are opened while their files are read (which needs the conversation ids). Each round trip costs a quarter second from
 * South Africa to the database in Ireland.
 */
export async function getContact(id: string): Promise<ContactDetail | null> {
  if (!isUuid(id)) return null;
  const [{ data: base, error }, thread_participants, touch] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, display_name, company, role, relationship, lead_source, ai_summary, about_note, vip, hidden, avatar_path, kind_override, organizations(id, name, logo_path), contact_identities(id, kind, value)")
      .eq("id", id)
      .maybeSingle(),
    // Their conversations are paged, so a contact with thousands of them is not cut off or too big for one response.
    allRows("Load contact conversations", (from, to) =>
      supabase
        .from("thread_participants")
        .select("thread_id, threads(id, channel, subject, group_name, is_group, status, last_message_preview, last_message_at, accounts(provider))")
        .eq("contact_id", id)
        .order("thread_id")
        .range(from, to),
    ),
    lastTouch(id),
  ]);
  if (error) throw new Error(`Load contact failed (${error.code})`);
  if (!base) return null;
  const c = { ...base, thread_participants };
  // Which conversations and which are groups are plain columns, so the files can be read before the titles are opened.
  const live = c.thread_participants.flatMap((p) => (p.threads && p.threads.status !== "trash" ? [p.threads] : []));
  const [, attachments] = await Promise.all([
    openNestedThreads([c]),
    contactAttachments(c.id, live.map((t) => t.id), new Set(live.filter((t) => t.is_group).map((t) => t.id))),
  ]);
  // Deleted conversations (in the provider's bin) are left out here, as in Conversations.
  const conversations = c.thread_participants
    .flatMap((p) => (p.threads && p.threads.status !== "trash" ? [p.threads] : []))
    .map((t) => ({
      id: t.id,
      channel: t.channel as ContactConversation["channel"],
      provider: (t.accounts?.provider ?? undefined) as Provider | undefined,
      isGroup: t.is_group,
      title: (t.is_group ? t.group_name : t.subject) ?? (t.channel === "email" ? "No Subject" : ({ whatsapp: "WhatsApp", instagram: "Instagram", linkedin: "LinkedIn", teams: "Teams", zoom: "Zoom", google_chat: "Google Chat" } as Record<string, string>)[t.channel] ?? "Conversation"),
      preview: t.last_message_preview,
      lastAt: t.last_message_at,
    }))
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  const ids = identities(c.contact_identities);
  const kindOverride = asKind(c.kind_override);
  const who = { name: c.display_name, ...ids, organizationName: c.organizations?.name ?? null, kindOverride };
  return {
    id: c.id,
    name: c.display_name,
    kindOverride,
    company: c.company,
    role: c.role,
    relationship: c.relationship,
    leadSource: c.lead_source?.trim() || null,
    hidden: c.hidden,
    summary: c.ai_summary,
    aboutNote: c.about_note?.trim() || null,
    vip: c.vip,
    ...touch,
    organization: c.organizations ? { id: c.organizations.id, name: c.organizations.name } : null,
    organizationName: c.organizations?.name ?? null,
    ...ids,
    lastAt: conversations[0]?.lastAt ?? null,
    avatarPath: c.avatar_path ?? companyLogo(who, logoAvatar(c.organizations?.logo_path)),
    isCompany: isCompanySender(who),
    conversations,
    conversationCount: conversations.length,
    identityRows: c.contact_identities,
    attachments,
  };
}

/** One contact's newest message from them and from you (contact_last_touch), for the status line on their page. */
async function lastTouch(contactId: string): Promise<{ lastInboundAt: string | null; lastOutboundAt: string | null }> {
  const { data, error } = await supabase.rpc("contact_last_touch", { p_contact: contactId });
  if (error) throw new Error(`Load last contact failed (${error.code})`);
  return { lastInboundAt: data?.[0]?.last_inbound_at ?? null, lastOutboundAt: data?.[0]?.last_outbound_at ?? null };
}

const ATTACHMENT_THREADS = 100;

async function contactAttachments(contactId: string, threadIds: string[], groupIds: Set<string>): Promise<FiledAttachment[]> {
  if (threadIds.length === 0) return [];
  const columns = await withSealedColumns("id, filename, kind, size_bytes, storage_path, team_path, hidden_reason, sealed, not_kept, messages!inner(id, thread_id, sent_at, direction, sender_contact_id)");
  // The ids go in the address of each request, so they are asked in chunks to keep it short.
  const chunks: string[][] = [];
  for (let i = 0; i < threadIds.length; i += ATTACHMENT_THREADS) chunks.push(threadIds.slice(i, i + ATTACHMENT_THREADS));
  const data = (
    await Promise.all(
      chunks.map((ids) =>
        allRows("Load contact attachments", (from, to) =>
          supabase
            .from("attachments")
            .select(columns)
            .eq("hidden", false)
            .in("messages.thread_id", ids)
            .order("id")
            .range(from, to),
        ),
      ),
    )
  ).flat();
  await openAddresses(data);
  return data
    .filter((a) => !groupIds.has(a.messages.thread_id) || a.messages.sender_contact_id === contactId)
    .map((a) => ({
      id: a.id,
      name: a.filename,
      kind: a.kind as Attachment["kind"],
      size: formatSize(a.size_bytes),
      path: a.team_path ?? a.storage_path ?? undefined,
      sealed: a.sealed || undefined,
      notKept: (a.not_kept as Attachment["notKept"]) ?? undefined,
      hiddenReason: (a.hidden_reason as Attachment["hiddenReason"]) ?? undefined,
      messageId: a.messages.id,
      threadId: a.messages.thread_id,
      sentAt: a.messages.sent_at,
      from: a.messages.direction === "outbound" ? "me" : a.messages.sender_contact_id ?? "unknown",
    }))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}
