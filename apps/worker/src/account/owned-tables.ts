// Every table with a user_id column, so "Delete My Account" can prove nothing of the person is left. All of them cascade from
// auth.users, so deleting the auth user removes their rows; after it the worker counts rows per table and fails the job if
// any remain. owned-tables.test.ts reads the migrations and fails when a new user_id table is missing here or does not
// cascade, which is how a table added later cannot slip past a deletion.

/** Tables with a user_id column (docs/PLAN.md, "Deleting an account"). Add a new one here in the same change as its migration. */
export const OWNED_TABLES = [
  "account_composer", "account_deletions", "account_removals", "accounts", "actions", "address_book_cards", "ai_batches", "ai_setup_grants", "ai_usage", "ai_usage_monthly",
  "attachment_fetch_requests", "attachments", "automation_previews", "automation_runs", "automations", "brief_parts", "brief_requests", "briefs", "bulk_reads",
  "calendar_deletes", "calendar_events", "calendar_outbox", "calendar_updates", "commitments", "compliance_exports", "compliance_opens",
  "contact_identities", "contact_merges", "contact_suggestions", "contacts", "document_reads", "draft_outcomes", "drafts", "email_originals",
  "feedback", "follow_ups", "instagram_sign_ins", "labels", "mail_actions", "meeting_participants", "meetings", "message_ai",
  "message_embeddings", "message_versions", "messages", "note_attachments", "note_links", "notes", "organizations", "outbox", "outbox_attachments",
  "priority_rules", "profiles", "push_subscriptions", "saved_views", "share_jobs", "storage_deletions", "style_rules", "task_updates",
  "tasks", "thread_label_removals", "thread_labels", "thread_links", "thread_notes", "thread_participants", "threads", "unsubscribes", "user_keys", "user_templates", "workspace_activity", "workspace_contact_agents",
  "client_cards", "event_preps", "matter_links", "matters",
  "workspace_inbox_access", "workspace_members", "writing_examples",
] as const;

/** Storage buckets that keep files under a "<user id>/" folder. The logos bucket is shared company art, not a person's. */
export const USER_BUCKETS = ["attachments", "avatars", "brief-audio"] as const;
