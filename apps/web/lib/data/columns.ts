// Row shapes and column lists for the data loaders. Named columns, never select("*"), so a column the app never reads
// (a WhatsApp QR or pairing code) never reaches the browser. Types and string constants only: no network.

import type { Tables } from "@messages/db";

export type ContactRow = Pick<Tables<"contacts">, "id" | "display_name" | "company" | "role" | "avatar_path"> & {
  kind_override?: string | null;
  organizations?: Pick<Tables<"organizations">, "id" | "name" | "logo_path"> | null;
};
export type IdentityRow = Pick<Tables<"contact_identities">, "kind" | "value">;
export type ThreadRow = Pick<
  Tables<"threads">,
  | "id" | "account_id" | "channel" | "subject" | "is_group" | "group_name" | "avatar_path" | "provider_thread_id" | "last_message_at"
  | "created_at" | "last_message_preview" | "junk" | "subscription" | "last_sender_contact_id" | "unread_count" | "pinned" | "status" | "priority" | "category" | "summary" | "needs_reply" | "last_from_me"
> & { workspace_id?: string | null; shared_by?: string | null; share_match?: string | null; share_suggestion?: string | null };
export type AttachmentRow = Pick<Tables<"attachments">, "id" | "message_id" | "filename" | "kind" | "size_bytes" | "storage_path" | "hidden" | "sealed" | "not_kept"> & { team_path?: string | null; thumb_path?: string | null };
export type MessageRow = Pick<
  Tables<"messages">,
  "id" | "provider_message_id" | "thread_id" | "direction" | "sender_contact_id" | "sender_address" | "to_addresses" | "sent_at" | "subject" | "body_text" | "body_html" | "provider_meta" | "has_original" | "is_bulk" | "body_marks" | "transcript"
> & { attachments: AttachmentRow[] };
export type AccountRow = Pick<Tables<"accounts">, "id" | "provider" | "label" | "nickname" | "address" | "status" | "status_detail" | "last_synced_at" | "send_addresses">;
export type ProfileRow = Pick<Tables<"profiles">, "display_name" | "avatar_path" | "about" | "important_people" | "quiet_start" | "quiet_end" | "push_urgent" | "push_important" | "auto_draft_top" | "whatsapp_read_receipts" | "share_usage" | "language">;
export type DraftRow = Pick<Tables<"drafts">, "id" | "body" | "tone" | "instruction" | "decision" | "decision_kind" | "source" | "auto" | "updated_at">;
export type UnsubscribeRow = Pick<Tables<"unsubscribes">, "id" | "account_id" | "sender_address" | "status" | "manual_url" | "error">;

// With the company, whose logo stands in for the photo of a sender that writes as the company.
export const CONTACT_COLUMNS = "id, display_name, company, role, avatar_path, kind_override, organizations(id, name, logo_path)";
export const THREAD_COLUMNS =
  "id, account_id, channel, subject, is_group, group_name, avatar_path, provider_thread_id, last_message_at, created_at, last_message_preview, junk, subscription, last_sender_contact_id, unread_count, pinned, status, priority, category, summary, needs_reply, last_from_me, workspace_id, shared_by, share_match, share_suggestion";
// One thread with its account's provider and its people in full, for a single conversation that has only just appeared.
export const THREAD_WITH_PEOPLE = `${THREAD_COLUMNS}, accounts(provider), thread_participants(contact_id, contacts(${CONTACT_COLUMNS}, contact_identities(kind, value)))` as const;
// The list: only the ids of who is in each thread. A person in fifty threads is sent once, by loadContacts, not fifty times here.
export const THREAD_WITH_IDS = `${THREAD_COLUMNS}, accounts(provider), thread_participants(contact_id)` as const;
// Explicit lists, so a column the app never reads (a WhatsApp QR or pairing code) never reaches every page.
export const ACCOUNT_COLUMNS = "id, provider, label, nickname, address, status, status_detail, last_synced_at, send_addresses";
export const PROFILE_COLUMNS = "display_name, avatar_path, about, important_people, quiet_start, quiet_end, push_urgent, push_important, auto_draft_top, whatsapp_read_receipts, share_usage, language";
export const DRAFT_COLUMNS = "id, thread_id, body, tone, instruction, decision, decision_kind, source, auto, updated_at";
export const UNSUBSCRIBE_COLUMNS = "id, account_id, sender_address, status, manual_url, error";
export const ATTACHMENT_COLUMNS = "id, message_id, filename, kind, size_bytes, storage_path, team_path, hidden, sealed, not_kept";
// Named columns, never select("*"). body_html is only still set on emails stored before the HTML stopped
// being kept (View Original now fetches it); is_bulk and has_original carry what it was needed for.
export const MESSAGE_COLUMNS = `id, provider_message_id, thread_id, direction, sender_contact_id, sender_address, to_addresses, sent_at, subject, body_text, body_html, provider_meta, has_original, is_bulk, body_marks, transcript, attachments(${ATTACHMENT_COLUMNS})` as const;
