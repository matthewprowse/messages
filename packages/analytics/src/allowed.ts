// Allow-lists for the analytics values that come from the page rather than from a fixed list in the code: a dialog's
// name, the names of the fields touched in it, and the title of an empty screen. A lone lowercase word ("sam") has the
// shape of a code word, so the word rule alone cannot keep a name that slipped into an id or a title out of an event.
// These do: anything not listed is recorded as "other". The cost of a new dialog or screen missing here is that it
// reads as "other" until it is added; the cost of the old way was a name reaching the table.

import { wordOf } from "./index";

/** What an unlisted value is recorded as. */
export const OTHER = "other";

/** The `track` names given to dialogs (Dialog and AlertDialog `track` prop). Add a name here when a dialog gets one. */
export const DIALOGS: ReadonlySet<string> = new Set([
  "attachment_viewer", "compliance_export", "compose", "delete_contact", "delete_event", "delete_note", "delete_task", "draft_reply",
  "edit_contact", "edit_text", "edit_event", "new_event", "edit_task", "new_task", "event_details", "inbox_access", "invite_member",
  "leave_team", "mark_work", "meeting_transcript", "merge_all_contacts", "merge_contacts", "merge_team_clients", "move_to_personal",
  "new_contact", "new_instagram", "new_linkedin", "new_whatsapp", "onboarding", "owner_invite", "pause_sync", "reassign_agent_chats",
  "remove_member", "remove_team_client", "remove_team_company", "rename_company", "rename_team_client", "save_event_scope", "set_cover",
  "set_team_client_agent", "set_team_client_company", "share_account", "split_contact", "strict_sharing_off", "task_details",
  "team_review", "view_original", "company_template", "company_fact", "remove_template", "remove_fact",
]);

/**
 * The words a form field's name may be made of. Fields are named by their `data-analytics`, `name` or `id`, and an id
 * can be built from data, so a field is kept only when every part of its name is one of these words. "compose_subject"
 * passes; "jane" or "client_3f2a" does not.
 */
export const FIELD_WORDS: ReadonlySet<string> = new Set([
  "about", "absent", "account", "address", "addresses", "agent", "all", "allday", "appearance", "apple", "back", "bcc", "before", "body", "brief",
  "by", "calendar", "cc", "chats", "client", "code", "companies", "company", "compose", "connect", "cover", "ctx", "curl", "daily", "data",
  "date", "day", "description", "drafts", "email", "end", "event", "export", "exports", "extra", "factor", "from", "guests", "host", "icloud",
  "id", "imap", "inbox", "inboxes", "input", "instagram", "invite", "invites", "item", "language", "linkedin", "location", "log", "meet",
  "members", "merge", "message", "mfa", "moved", "name", "nickname", "notes", "own", "oversight", "password", "people", "phone", "photo",
  "port", "priorities", "priority", "profile", "proxy", "published", "reassign", "reminders", "repeat", "reply", "response", "review", "role",
  "search", "security", "send", "settings", "setup", "shared", "show", "smtp", "split", "start", "storage", "style", "subject", "summary",
  "task", "team", "text", "through", "time", "title", "tls", "to", "tour", "transcript", "two", "txt", "update", "use", "username", "version",
  "voice", "whatsapp", "with", "work", "writing",
]);

/** The titles of empty or failed screens (EmptyState), as code words. */
export const EMPTY_STATES: ReadonlySet<string> = new Set([
  "company_not_found", "contact_not_found", "conversation_not_found", "could_not_load_ai_usage", "could_not_load_notes",
  "could_not_load_teams", "could_not_load_updates", "could_not_load_the_ai_budget", "could_not_load_the_waitlist", "could_not_open_note",
  "importing_your_messages", "no_ai_use_yet", "no_attachments", "no_companies", "no_data", "no_events", "no_matches", "no_notes_yet",
  "no_suggested_merges", "no_team_clients_yet", "no_teams_yet", "note_not_found", "nothing_captured_yet", "owner_only", "pick_a_company",
  "pick_a_section", "select_a_conversation", "suggestions_did_not_load",
]);

/** A dialog's name if it is a known one, else "other". Undefined when there is no name (the dialog is not tracked). */
export function dialogWord(name: string | null | undefined): string | undefined {
  const w = wordOf(name);
  return w === undefined ? undefined : DIALOGS.has(w) ? w : OTHER;
}

/** A field's name if every part of it is a known word, else "other". Undefined when it is not a word at all. */
export function fieldWord(raw: string | null | undefined): string | undefined {
  const w = wordOf(raw);
  return w === undefined ? undefined : w.split("_").every((part) => FIELD_WORDS.has(part)) ? w : OTHER;
}

/** An empty screen's title if it is a known one, else "other". Undefined when the title is not a word. */
export function emptyStateWord(title: string | null | undefined): string | undefined {
  const w = wordOf(title);
  return w === undefined ? undefined : EMPTY_STATES.has(w) ? w : OTHER;
}

/**
 * The props of an event with its free-form values put through the allow-lists above. Everything else is left to
 * cleanProps. Called by track() for every event, so a call site cannot skip it.
 */
export function guardProps(name: string, props: Record<string, unknown>): Record<string, unknown> {
  if (name === "dialog_open" || name === "dialog_close") {
    const out: Record<string, unknown> = { ...props, dialog: dialogWord(props.dialog as string) };
    if (Array.isArray(props.fields)) out.fields = [...new Set(props.fields.map((f) => fieldWord(f as string)).filter((f): f is string => !!f))];
    return out;
  }
  if (name === "empty_state") return { ...props, what: emptyStateWord(props.what as string) };
  return props;
}
