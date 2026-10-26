// Shared database types for the web app and the sync worker.
// Regenerate after any migration with `pnpm --filter @messages/db gen:types` (needs `supabase login`).
export type { Database, Json, Tables, TablesInsert, TablesUpdate } from "./database.types";

import type { Tables } from "./database.types";

export type Account = Tables<"accounts">;
export type Thread = Tables<"threads">;
export type Message = Tables<"messages">;
export type Contact = Tables<"contacts">;
export type ContactIdentity = Tables<"contact_identities">;
export type Attachment = Tables<"attachments">;
export type Draft = Tables<"drafts">;

export type Provider = "icloud" | "gmail" | "google_calendar" | "outlook" | "outlook_calendar" | "icloud_calendar" | "whatsapp" | "imap" | "teams" | "zoom" | "google_meet" | "linkedin" | "instagram" | "microsoft_todo" | "google_tasks" | "icloud_reminders";
export type AccountStatus = "connecting" | "syncing" | "connected" | "disconnected" | "error";
export type OutboxStatus = "queued" | "sending" | "sent" | "failed";
export type Channel = "email" | "whatsapp" | "linkedin" | "instagram" | "teams" | "zoom" | "google_chat";
export type Priority = "urgent" | "important" | "normal" | "low";
