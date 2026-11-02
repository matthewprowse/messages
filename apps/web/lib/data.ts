// Entry point for loading rows from Supabase and mapping them to the shapes the screens use. The work lives in
// lib/data/: columns and row types, pure mappers (map-*.ts) and one loader group per file (load-*.ts). Import from
// here so callers do not care where a name moved.

export { CONTACT_COLUMNS, UNSUBSCRIBE_COLUMNS, type MessageRow } from "./data/columns";
export { mapContact } from "./data/map-contact";
export { leadParticipant, mapThread, threadWithIds } from "./data/map-thread";
export { emailMarks, mapAttachment, mapMessage, patchMessage, whatsappExtras } from "./data/map-message";
export { EMPTY_PROFILE, mapAccount, mapDraft, mapUnsubscribe, profilePatch } from "./data/map-small";
export { loadTasks } from "./data/load-small";
export { loadChanges, loadEverything, loadThread, type Loaded } from "./data/load-threads";
export { loadOutbox } from "./data/load-outbox";
export { listContactsFromStore, loadContacts } from "./data/load-contacts";
export { loadMessage, loadMessageAttachments, loadMessagesAfter, loadThreadMessages, MESSAGE_PAGE, messageSentAt, type MessagePage } from "./data/load-messages";
export { loadAttachments } from "./data/load-attachments";
