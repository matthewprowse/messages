// Maps thread rows (with their participants) to the app's Thread. Pure: no network, no database.

import type { Category, Contact, Priority, Provider, Thread } from "../types";
import { formatPhone } from "../format";
import { mapContact } from "./map-contact";
import type { ContactRow, IdentityRow, ThreadRow } from "./columns";

/** A WhatsApp chat's own name when no person is stored for it: its number, or WhatsApp for its own account. */
function whatsappChatName(chatId: string): string | undefined {
  const user = chatId.split("@")[0];
  if (!/^\d+$/.test(user)) return undefined;
  return user.length < 6 ? "WhatsApp" : formatPhone(`+${user}`);
}

/** The conversation is shown as its first participant, so whoever sent the latest message leads. An email
 *  can have several people in it, such as a forward from one that copies in another. */
export function leadParticipant(participantIds: string[], lead: string | null | undefined): string[] {
  if (lead && participantIds[0] !== lead && participantIds.includes(lead)) return [lead, ...participantIds.filter((id) => id !== lead)];
  return participantIds;
}

export function mapThread(row: ThreadRow, participantIds: string[], provider: Provider): Thread {
  participantIds = leadParticipant(participantIds, row.last_sender_contact_id);
  return {
    id: row.id,
    accountId: row.account_id,
    channel: row.channel as Thread["channel"],
    provider,
    subject: row.subject ?? undefined,
    participantIds,
    isGroup: row.is_group,
    groupName: row.group_name ?? undefined,
    avatarPath: row.avatar_path ?? undefined,
    fallbackName: row.channel === "whatsapp" && !row.is_group ? whatsappChatName(row.provider_thread_id) : undefined,
    lastMessageAt: row.last_message_at ?? row.created_at,
    preview: row.last_message_preview ?? undefined,
    junk: row.junk,
    subscription: row.subscription,
    unread: row.unread_count > 0,
    unreadCount: row.unread_count,
    pinned: row.pinned,
    status: row.status as Thread["status"],
    // AI triage is not running yet, so untriaged conversations are treated as normal.
    priority: (row.priority as Priority | null) ?? "normal",
    category: (row.category as Category | null) ?? "fyi",
    summary: row.summary ?? "",
    needsReply: row.needs_reply,
    lastFromMe: row.last_from_me,
    lastSenderId: row.last_sender_contact_id ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    sharedBy: (row.shared_by as Thread["sharedBy"]) ?? undefined,
    shareMatch: row.share_match ?? undefined,
    shareSuggestion: row.share_suggestion === "suggested" ? "suggested" : undefined,
  };
}

export type ThreadWithPeople = ThreadRow & {
  accounts: { provider: string } | null;
  thread_participants: { contact_id: string; contacts: (ContactRow & { contact_identities: IdentityRow[] }) | null }[];
};

export type ThreadWithIds = ThreadRow & { accounts: { provider: string } | null; thread_participants: { contact_id: string }[] };

/** A listed thread row with the ids of its people. */
export function threadWithIds(row: ThreadWithIds): Thread {
  return mapThread(row, row.thread_participants.map((p) => p.contact_id), (row.accounts?.provider as Provider | undefined) ?? "icloud");
}

/** A thread row with its people embedded, and those people as contacts. */
export function threadWithPeople(row: ThreadWithPeople, contacts: Map<string, Contact>): Thread {
  for (const p of row.thread_participants) {
    if (p.contacts && !contacts.has(p.contact_id)) contacts.set(p.contact_id, mapContact(p.contacts, p.contacts.contact_identities));
  }
  return mapThread(row, row.thread_participants.map((p) => p.contact_id), (row.accounts?.provider as Provider | undefined) ?? "icloud");
}
